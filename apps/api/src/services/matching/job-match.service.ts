import { prisma } from '../../db/prisma.js';
import type { Prisma, Job as PrismaJob, JobMatch as PrismaJobMatch } from '@prisma/client';
import { DeterministicMatchService } from './deterministic-match.service.js';
import { jobMatchAIService, JobMatchAIService } from '../ai/job-match-ai.service.js';
import { matchScoreService, MatchScoreService } from './match-score.service.js';
import type {
  Job,
  JobMatch,
  JobMatchResponse,
  JobMatchListResponse,
  JobMatchSearchParams,
  MatchRecommendation,
  JobMatchAnalysis,
} from '@ai-job-agent/shared';

export class CandidateProfileNotFoundError extends Error {
  constructor(
    message = 'Candidate profile not found. Please create a profile or upload a resume before matching jobs.'
  ) {
    super(message);
    this.name = 'CandidateProfileNotFoundError';
  }
}

export class MatchNotFoundError extends Error {
  constructor(jobId: string) {
    super(`No match analysis found for job with ID "${jobId}".`);
    this.name = 'MatchNotFoundError';
  }
}

import { JobNotFoundError } from '../jobs/job.service.js';
export { JobNotFoundError };

export class JobMatchService {
  constructor(
    private readonly deterministicService = DeterministicMatchService,
    private readonly aiService: JobMatchAIService = jobMatchAIService,
    private readonly scoreService: MatchScoreService = matchScoreService
  ) {}

  /**
   * Evaluates and persists a match between the candidate profile and the specified job.
   * If a match already exists, updates the record to prevent duplicates.
   */
  async matchJob(jobId: string, userProfileId?: string): Promise<JobMatchResponse> {
    // 1. Fetch Job
    const jobRecord = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        jobSource: {
          select: { id: true, name: true, type: true },
        },
      },
    });

    if (!jobRecord) {
      throw new JobNotFoundError(jobId);
    }

    // 2. Fetch Active Candidate Profile
    const profile = await prisma.userProfile.findFirst({
      where: userProfileId ? { id: userProfileId } : undefined,
      orderBy: { createdAt: 'asc' },
      include: {
        skills: true,
        experiences: { orderBy: { startDate: 'desc' } },
        education: true,
        jobPreferences: true,
      },
    });

    if (!profile) {
      throw new CandidateProfileNotFoundError();
    }

    const job = this.mapPrismaJob(jobRecord);
    const primaryPref = profile.jobPreferences[0] || null;

    // 3. Deterministic Matching
    const candidateData = {
      id: profile.id,
      fullName: profile.fullName,
      currentTitle: profile.currentTitle,
      yearsOfExperience: profile.yearsOfExperience,
      skills: profile.skills.map((s) => ({
        name: s.name,
        category: s.category,
        proficiency: s.proficiency,
      })),
      experiences: profile.experiences.map((e) => ({
        company: e.company,
        jobTitle: e.jobTitle,
        description: e.description,
      })),
      jobPreferences: primaryPref
        ? {
            preferredRoles: primaryPref.preferredRoles,
            preferredLocations: primaryPref.preferredLocations,
            workModes: primaryPref.workModes,
            preferredIndustries: primaryPref.preferredIndustries,
            minimumSalary: primaryPref.minimumSalary,
            salaryCurrency: null,
          }
        : null,
    };

    const deterministic = this.deterministicService.evaluate(candidateData, job);

    // 4. Ollama Semantic Analysis (with concurrency guard and prompt security delimiters)
    const aiResult = await this.aiService.analyzeMatch(
      {
        professionalSummary: profile.professionalSummary,
        currentTitle: profile.currentTitle,
        yearsOfExperience: profile.yearsOfExperience,
        skills: profile.skills.map((s) => ({
          name: s.name,
          category: s.category,
          proficiency: s.proficiency,
        })),
        experience: profile.experiences.map((e) => ({
          company: e.company,
          jobTitle: e.jobTitle,
          startDate: e.startDate ? e.startDate.toISOString().slice(0, 10) : null,
          endDate: e.endDate ? e.endDate.toISOString().slice(0, 10) : null,
          isCurrent: e.isCurrent,
          description: e.description,
        })),
        education: profile.education.map((ed) => ({
          institution: ed.institution,
          degree: ed.degree,
          fieldOfStudy: ed.fieldOfStudy,
        })),
        preferences: primaryPref
          ? {
              preferredRoles: primaryPref.preferredRoles,
              preferredLocations: primaryPref.preferredLocations,
              workModes: primaryPref.workModes,
              preferredIndustries: primaryPref.preferredIndustries,
              minimumSalary: primaryPref.minimumSalary,
              currency: null,
            }
          : null,
      },
      {
        title: job.title,
        company: job.companyName,
        description: job.description,
        location: job.location,
        workMode: job.workMode,
        employmentType: job.employmentType,
        experienceLevel: job.experienceLevel,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        salaryCurrency: job.salaryCurrency,
        publishedAt: job.publishedAt,
      }
    );

    // 5. Combine Scores and Calculate Recommendation
    const combined = this.scoreService.calculateScores({
      deterministicSkillScore: deterministic.deterministicSkillScore,
      semanticSkillScore: aiResult.semanticSkillScore,
      deterministicExperienceScore: deterministic.deterministicExperienceScore,
      deterministicRoleScore: deterministic.deterministicRoleScore,
      roleAlignmentScore: aiResult.roleAlignmentScore,
      deterministicPreferenceScore: deterministic.deterministicPreferenceScore,
      deterministicLocationScore: deterministic.deterministicLocationScore,
    });

    // 6. Build Deterministic Strengths & Gaps
    const deterministicStrengths: string[] = [];
    const deterministicGaps: string[] = [];

    if (deterministic.matchedSkills.length > 0) {
      deterministicStrengths.push(
        `Matched skills: ${deterministic.matchedSkills.slice(0, 4).join(', ')}`
      );
    }
    if (deterministic.deterministicExperienceScore >= 85) {
      deterministicStrengths.push('Experience level satisfies or exceeds target requirement');
    }
    if (
      deterministic.candidateRoleFamily === deterministic.jobRoleFamily &&
      deterministic.candidateRoleFamily !== 'OTHER'
    ) {
      deterministicStrengths.push(`Direct role family match in ${deterministic.candidateRoleFamily}`);
    }
    if (deterministic.deterministicLocationScore >= 90) {
      deterministicStrengths.push('Compatible work mode and location');
    }

    if (deterministic.missingSkills.length > 0) {
      deterministicGaps.push(`Missing skills: ${deterministic.missingSkills.slice(0, 3).join(', ')}`);
    }
    if (deterministic.deterministicExperienceScore < 60) {
      deterministicGaps.push('Candidate experience level is below the required range');
    }
    if (deterministic.deterministicLocationScore < 60) {
      deterministicGaps.push('Location or work mode may require relocation or adjustments');
    }

    const { strengths, gaps } = this.scoreService.mergeStrengthsAndGaps(
      deterministicStrengths,
      aiResult.strengths,
      deterministicGaps,
      aiResult.gaps
    );

    // 7. Persist or Update Match in Database (Transaction / Upsert)
    const savedMatch = await prisma.jobMatch.upsert({
      where: {
        jobId_userProfileId: {
          jobId: job.id,
          userProfileId: profile.id,
        },
      },
      create: {
        jobId: job.id,
        userProfileId: profile.id,
        overallScore: combined.overallScore,
        skillScore: combined.scores.skill,
        experienceScore: combined.scores.experience,
        roleScore: combined.scores.role,
        preferenceScore: combined.scores.preference,
        locationScore: combined.scores.location,
        recommendation: combined.recommendation,
        strengths,
        gaps,
        aiAnalysis: aiResult as unknown as Prisma.InputJsonValue,
      },
      update: {
        overallScore: combined.overallScore,
        skillScore: combined.scores.skill,
        experienceScore: combined.scores.experience,
        roleScore: combined.scores.role,
        preferenceScore: combined.scores.preference,
        locationScore: combined.scores.location,
        recommendation: combined.recommendation,
        strengths,
        gaps,
        aiAnalysis: aiResult as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      id: savedMatch.id,
      jobId: savedMatch.jobId,
      overallScore: savedMatch.overallScore,
      recommendation: savedMatch.recommendation as MatchRecommendation,
      scores: {
        skill: savedMatch.skillScore,
        experience: savedMatch.experienceScore,
        role: savedMatch.roleScore,
        preference: savedMatch.preferenceScore,
        location: savedMatch.locationScore,
      },
      strengths: savedMatch.strengths,
      gaps: savedMatch.gaps,
      explanation: aiResult.explanation,
      createdAt: savedMatch.createdAt.toISOString(),
      updatedAt: savedMatch.updatedAt.toISOString(),
    };
  }

  /**
   * Retrieves an existing match for the current profile and the given job ID
   */
  async getMatchByJobId(jobId: string, userProfileId?: string): Promise<JobMatchResponse> {
    const profile = await prisma.userProfile.findFirst({
      where: userProfileId ? { id: userProfileId } : undefined,
      orderBy: { createdAt: 'asc' },
    });

    if (!profile) {
      throw new CandidateProfileNotFoundError();
    }

    const match = await prisma.jobMatch.findUnique({
      where: {
        jobId_userProfileId: {
          jobId,
          userProfileId: profile.id,
        },
      },
    });

    if (!match) {
      throw new MatchNotFoundError(jobId);
    }

    const aiAnalysis = match.aiAnalysis as unknown as JobMatchAnalysis;

    return {
      id: match.id,
      jobId: match.jobId,
      overallScore: match.overallScore,
      recommendation: match.recommendation as MatchRecommendation,
      scores: {
        skill: match.skillScore,
        experience: match.experienceScore,
        role: match.roleScore,
        preference: match.preferenceScore,
        location: match.locationScore,
      },
      strengths: match.strengths,
      gaps: match.gaps,
      explanation: aiAnalysis?.explanation || '',
      createdAt: match.createdAt.toISOString(),
      updatedAt: match.updatedAt.toISOString(),
    };
  }

  /**
   * Retrieves paginated matches with optional score and recommendation filters
   */
  async getMatches(params: JobMatchSearchParams): Promise<JobMatchListResponse> {
    const profile = await prisma.userProfile.findFirst({
      orderBy: { createdAt: 'asc' },
    });

    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 10));
    const skip = (page - 1) * pageSize;

    if (!profile) {
      return {
        matches: [],
        pagination: {
          total: 0,
          page,
          pageSize,
          totalPages: 0,
        },
      };
    }

    const where: Prisma.JobMatchWhereInput = {
      userProfileId: profile.id,
    };

    if (params.minimumScore !== undefined && !Number.isNaN(Number(params.minimumScore))) {
      where.overallScore = { gte: Number(params.minimumScore) };
    }

    if (params.recommendation) {
      where.recommendation = params.recommendation;
    }

    let orderBy: Prisma.JobMatchOrderByWithRelationInput = { overallScore: 'desc' };
    if (params.sort === 'overallScore_asc') {
      orderBy = { overallScore: 'asc' };
    } else if (params.sort === 'createdAt_desc') {
      orderBy = { createdAt: 'desc' };
    } else if (params.sort === 'createdAt_asc') {
      orderBy = { createdAt: 'asc' };
    }

    const [total, records] = await Promise.all([
      prisma.jobMatch.count({ where }),
      prisma.jobMatch.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: {
          job: {
            include: {
              jobSource: {
                select: { id: true, name: true, type: true },
              },
            },
          },
        },
      }),
    ]);

    const matches: (JobMatch & { job: Job })[] = records.map((record) => {
      const mappedJob = this.mapPrismaJob(record.job);
      return {
        id: record.id,
        jobId: record.jobId,
        userProfileId: record.userProfileId,
        overallScore: record.overallScore,
        skillScore: record.skillScore,
        experienceScore: record.experienceScore,
        roleScore: record.roleScore,
        preferenceScore: record.preferenceScore,
        locationScore: record.locationScore,
        recommendation: record.recommendation as MatchRecommendation,
        strengths: record.strengths,
        gaps: record.gaps,
        aiAnalysis: record.aiAnalysis as unknown as JobMatchAnalysis,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        job: mappedJob,
      };
    });

    return {
      matches,
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  private mapPrismaJob(
    record: PrismaJob & {
      jobSource?: { id: string; name: string; type: any };
    }
  ): Job {
    return {
      id: record.id,
      jobSourceId: record.jobSourceId,
      jobSource: record.jobSource,
      externalId: record.externalId,
      title: record.title,
      companyName: record.companyName,
      description: record.description,
      location: record.location,
      locations: record.locations,
      workMode: record.workMode,
      employmentType: record.employmentType,
      experienceLevel: record.experienceLevel,
      salaryMin: record.salaryMin,
      salaryMax: record.salaryMax,
      salaryCurrency: record.salaryCurrency,
      applicationUrl: record.applicationUrl,
      publishedAt: record.publishedAt ? record.publishedAt.toISOString() : null,
      expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

export const jobMatchService = new JobMatchService();
