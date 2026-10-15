import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../db/prisma.js';
import { config } from '../../config/env.js';
import {
  type Application,
  type ApplicationWorkspace,
  type ApplicationSearchParams,
  type ApplicationListResponse,
  type ApplicationListItem,
  type UpdateApplicationInput,
  type ApplicationExportResponse,
  type ApplicationExportFile,
  type ApplicationStatus,
} from '@ai-job-agent/shared';
import { JobNotFoundError } from '../jobs/job.service.js';
import { CandidateProfileNotFoundError } from '../matching/job-match.service.js';
import {
  applicationGeneratorService,
  ApplicationGeneratorService,
} from './application-generator.service.js';

export class ApplicationNotFoundError extends Error {
  constructor(id: string) {
    super(`Application with ID "${id}" was not found.`);
    this.name = 'ApplicationNotFoundError';
  }
}

export class InvalidStateTransitionError extends Error {
  constructor(fromStatus: string, toStatus: string, message?: string) {
    super(
      message ||
        `Invalid status transition from "${fromStatus}" to "${toStatus}". Applications must follow the strict lifecycle: DRAFT -> IN_REVIEW -> APPROVED/REJECTED -> EXPORTED.`
    );
    this.name = 'InvalidStateTransitionError';
  }
}

export class ApplicationService {
  constructor(
    private readonly generator: ApplicationGeneratorService = applicationGeneratorService,
    private readonly exportBaseDir: string = config.exportDir
  ) {}

  /**
   * Retrieves active candidate profile with complete relations
   */
  private async getActiveProfile() {
    const profile = await prisma.userProfile.findFirst({
      include: {
        skills: true,
        experiences: true,
        education: true,
        jobPreferences: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!profile) {
      throw new CandidateProfileNotFoundError();
    }
    return profile;
  }

  /**
   * Create or retrieve Application workspace for a given job.
   */
  async createOrGetApplication(jobId: string, userProfileId?: string): Promise<ApplicationWorkspace> {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        jobSource: true,
      },
    });

    if (!job) {
      throw new JobNotFoundError(jobId);
    }

    let profile;
    if (userProfileId) {
      profile = await prisma.userProfile.findUnique({
        where: { id: userProfileId },
      });
      if (!profile) {
        throw new CandidateProfileNotFoundError();
      }
    } else {
      profile = await this.getActiveProfile();
    }

    // Check for existing Application
    let application = await prisma.application.findUnique({
      where: {
        jobId_userProfileId: {
          jobId,
          userProfileId: profile.id,
        },
      },
      include: {
        answers: { orderBy: { createdAt: 'asc' } },
        documents: true,
      },
    });

    if (!application) {
      application = await prisma.application.create({
        data: {
          jobId,
          userProfileId: profile.id,
          status: 'DRAFT',
        },
        include: {
          answers: true,
          documents: true,
        },
      });
    }

    return this.getApplicationWorkspace(application.id);
  }

  /**
   * Get complete application workspace by ID.
   */
  async getApplicationWorkspace(id: string): Promise<ApplicationWorkspace> {
    const application = await prisma.application.findUnique({
      where: { id },
      include: {
        job: {
          include: {
            jobSource: true,
          },
        },
        userProfile: {
          include: {
            skills: true,
            experiences: true,
            education: true,
          },
        },
        answers: {
          orderBy: { createdAt: 'asc' },
        },
        documents: true,
      },
    });

    if (!application) {
      throw new ApplicationNotFoundError(id);
    }

    // Lookup match if exists
    const match = await prisma.jobMatch.findUnique({
      where: {
        jobId_userProfileId: {
          jobId: application.jobId,
          userProfileId: application.userProfileId,
        },
      },
    });

    const documentsMap = {
      COVER_LETTER: application.documents.find((d) => d.type === 'COVER_LETTER') || null,
      RESUME_BULLETS: application.documents.find((d) => d.type === 'RESUME_BULLETS') || null,
      APPLICATION_SUMMARY: application.documents.find((d) => d.type === 'APPLICATION_SUMMARY') || null,
    };

    return {
      application: {
        id: application.id,
        jobId: application.jobId,
        userProfileId: application.userProfileId,
        status: application.status as any,
        rejectionReason: application.rejectionReason,
        approvedAt: application.approvedAt ? application.approvedAt.toISOString() : null,
        createdAt: application.createdAt.toISOString(),
        updatedAt: application.updatedAt.toISOString(),
        answers: application.answers.map((a) => ({
          ...a,
          source: a.source as any,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
        documents: application.documents.map((d) => ({
          ...d,
          type: d.type as any,
          source: d.source as any,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        })),
        match: match
          ? {
              ...match,
              recommendation: match.recommendation as any,
              aiAnalysis: match.aiAnalysis as any,
              createdAt: match.createdAt.toISOString(),
              updatedAt: match.updatedAt.toISOString(),
            }
          : null,
      },
      job: {
        ...application.job,
        workMode: application.job.workMode as any,
        employmentType: application.job.employmentType as any,
        experienceLevel: application.job.experienceLevel as any,
        publishedAt: application.job.publishedAt ? application.job.publishedAt.toISOString() : null,
        expiresAt: application.job.expiresAt ? application.job.expiresAt.toISOString() : null,
        createdAt: application.job.createdAt.toISOString(),
        updatedAt: application.job.updatedAt.toISOString(),
      },
      userProfile: {
        ...application.userProfile,
        createdAt: application.userProfile.createdAt.toISOString(),
        updatedAt: application.userProfile.updatedAt.toISOString(),
      },
      match: match
        ? {
            ...match,
            recommendation: match.recommendation as any,
            aiAnalysis: match.aiAnalysis as any,
            createdAt: match.createdAt.toISOString(),
            updatedAt: match.updatedAt.toISOString(),
          }
        : null,
      answers: application.answers.map((a) => ({
        ...a,
        source: a.source as any,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
      documents: {
        COVER_LETTER: documentsMap.COVER_LETTER
          ? {
              ...documentsMap.COVER_LETTER,
              type: documentsMap.COVER_LETTER.type as any,
              source: documentsMap.COVER_LETTER.source as any,
              createdAt: documentsMap.COVER_LETTER.createdAt.toISOString(),
              updatedAt: documentsMap.COVER_LETTER.updatedAt.toISOString(),
            }
          : null,
        RESUME_BULLETS: documentsMap.RESUME_BULLETS
          ? {
              ...documentsMap.RESUME_BULLETS,
              type: documentsMap.RESUME_BULLETS.type as any,
              source: documentsMap.RESUME_BULLETS.source as any,
              createdAt: documentsMap.RESUME_BULLETS.createdAt.toISOString(),
              updatedAt: documentsMap.RESUME_BULLETS.updatedAt.toISOString(),
            }
          : null,
        APPLICATION_SUMMARY: documentsMap.APPLICATION_SUMMARY
          ? {
              ...documentsMap.APPLICATION_SUMMARY,
              type: documentsMap.APPLICATION_SUMMARY.type as any,
              source: documentsMap.APPLICATION_SUMMARY.source as any,
              createdAt: documentsMap.APPLICATION_SUMMARY.createdAt.toISOString(),
              updatedAt: documentsMap.APPLICATION_SUMMARY.updatedAt.toISOString(),
            }
          : null,
      },
    };
  }

  /**
   * List applications with filtering, search, and pagination.
   */
  async getApplications(params: ApplicationSearchParams): Promise<ApplicationListResponse> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
    const skip = (page - 1) * pageSize;

    const where: any = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.company) {
      where.job = {
        ...where.job,
        companyName: { contains: params.company, mode: 'insensitive' },
      };
    }

    if (params.search) {
      where.job = {
        ...where.job,
        OR: [
          { title: { contains: params.search, mode: 'insensitive' } },
          { companyName: { contains: params.search, mode: 'insensitive' } },
        ],
      };
    }

    const [total, applications] = await Promise.all([
      prisma.application.count({ where }),
      prisma.application.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
        include: {
          job: {
            include: {
              jobSource: true,
              matches: {
                take: 1,
              },
            },
          },
          answers: true,
          documents: true,
        },
      }),
    ]);

    const formattedApplications: ApplicationListItem[] = applications.map((app) => {
      const match = app.job.matches[0];
      return {
        id: app.id,
        jobId: app.jobId,
        userProfileId: app.userProfileId,
        status: app.status as any,
        rejectionReason: app.rejectionReason,
        approvedAt: app.approvedAt ? app.approvedAt.toISOString() : null,
        createdAt: app.createdAt.toISOString(),
        updatedAt: app.updatedAt.toISOString(),
        matchScore: match ? match.overallScore : null,
        match: match
          ? {
              ...match,
              recommendation: match.recommendation as any,
              aiAnalysis: match.aiAnalysis as any,
              createdAt: match.createdAt.toISOString(),
              updatedAt: match.updatedAt.toISOString(),
            }
          : null,
        job: {
          ...app.job,
          workMode: app.job.workMode as any,
          employmentType: app.job.employmentType as any,
          experienceLevel: app.job.experienceLevel as any,
          publishedAt: app.job.publishedAt ? app.job.publishedAt.toISOString() : null,
          expiresAt: app.job.expiresAt ? app.job.expiresAt.toISOString() : null,
          createdAt: app.job.createdAt.toISOString(),
          updatedAt: app.job.updatedAt.toISOString(),
        },
        answers: app.answers.map((a) => ({
          ...a,
          source: a.source as any,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
        documents: app.documents.map((d) => ({
          ...d,
          type: d.type as any,
          source: d.source as any,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        })),
      };
    });

    // If minimumScore filter was specified, filter memory-side or by query
    let filteredItems = formattedApplications;
    if (params.minimumScore !== undefined) {
      filteredItems = formattedApplications.filter(
        (item) => item.matchScore != null && item.matchScore >= params.minimumScore!
      );
    }

    return {
      applications: filteredItems,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize) || 1,
      },
    };
  }

  /**
   * Generates tailored application materials (summary, cover letter, resume bullets)
   */
  async generateApplicationContent(id: string) {
    const app = await prisma.application.findUnique({
      where: { id },
      include: {
        job: true,
        userProfile: {
          include: {
            skills: true,
            experiences: true,
            education: true,
          },
        },
      },
    });

    if (!app) {
      throw new ApplicationNotFoundError(id);
    }

    // Lookup match if exists
    const match = await prisma.jobMatch.findUnique({
      where: {
        jobId_userProfileId: {
          jobId: app.jobId,
          userProfileId: app.userProfileId,
        },
      },
    });

    const candidateInput = {
      fullName: app.userProfile.fullName,
      currentTitle: app.userProfile.currentTitle,
      yearsOfExperience: app.userProfile.yearsOfExperience,
      professionalSummary: app.userProfile.professionalSummary,
      skills: app.userProfile.skills.map((s) => ({ name: s.name, category: s.category })),
      experience: app.userProfile.experiences.map((e) => ({
        id: e.id,
        company: e.company,
        jobTitle: e.jobTitle,
        startDate: e.startDate ? e.startDate.toISOString().slice(0, 7) : null,
        endDate: e.endDate ? e.endDate.toISOString().slice(0, 7) : null,
        isCurrent: e.isCurrent,
        description: e.description,
      })),
      education: app.userProfile.education.map((ed) => ({
        institution: ed.institution,
        degree: ed.degree,
        fieldOfStudy: ed.fieldOfStudy,
      })),
    };

    const jobInput = {
      id: app.job.id,
      title: app.job.title,
      company: app.job.companyName,
      description: app.job.description,
      location: app.job.location,
      workMode: app.job.workMode,
      employmentType: app.job.employmentType,
      experienceLevel: app.job.experienceLevel,
    };

    const matchInput = match
      ? {
          overallScore: match.overallScore,
          strengths: match.strengths,
          gaps: match.gaps,
          explanation: (match.aiAnalysis as any)?.explanation || null,
        }
      : null;

    // Call generator
    const genResult = await this.generator.generateApplication(candidateInput, jobInput, matchInput);

    // Format resume bullets as text
    const bulletsText = genResult.data.resumeBullets
      .map((b) => `- ${b.company ? `[${b.company}] ` : ''}${b.bullet}`)
      .join('\n\n');

    // Upsert ApplicationDocument records
    await Promise.all([
      prisma.applicationDocument.upsert({
        where: {
          applicationId_type: {
            applicationId: id,
            type: 'APPLICATION_SUMMARY',
          },
        },
        create: {
          applicationId: id,
          type: 'APPLICATION_SUMMARY',
          content: genResult.data.summary,
          originalContent: genResult.data.summary,
          source: 'AI_GENERATED',
        },
        update: {
          content: genResult.data.summary,
          originalContent: genResult.data.summary,
          source: 'AI_GENERATED',
        },
      }),
      prisma.applicationDocument.upsert({
        where: {
          applicationId_type: {
            applicationId: id,
            type: 'COVER_LETTER',
          },
        },
        create: {
          applicationId: id,
          type: 'COVER_LETTER',
          content: genResult.data.coverLetter,
          originalContent: genResult.data.coverLetter,
          source: 'AI_GENERATED',
        },
        update: {
          content: genResult.data.coverLetter,
          originalContent: genResult.data.coverLetter,
          source: 'AI_GENERATED',
        },
      }),
      prisma.applicationDocument.upsert({
        where: {
          applicationId_type: {
            applicationId: id,
            type: 'RESUME_BULLETS',
          },
        },
        create: {
          applicationId: id,
          type: 'RESUME_BULLETS',
          content: bulletsText,
          originalContent: bulletsText,
          source: 'AI_GENERATED',
        },
        update: {
          content: bulletsText,
          originalContent: bulletsText,
          source: 'AI_GENERATED',
        },
      }),
    ]);

    // Touch application updatedAt
    await prisma.application.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    const workspace = await this.getApplicationWorkspace(id);
    return {
      workspace,
      validation: genResult.validation,
    };
  }

  /**
   * Generates answers for arbitrary questions and persists them
   */
  async generateAnswers(id: string, questions: string[]) {
    const app = await prisma.application.findUnique({
      where: { id },
      include: {
        job: true,
        userProfile: {
          include: {
            skills: true,
            experiences: true,
            education: true,
          },
        },
      },
    });

    if (!app) {
      throw new ApplicationNotFoundError(id);
    }

    const candidateInput = {
      fullName: app.userProfile.fullName,
      currentTitle: app.userProfile.currentTitle,
      yearsOfExperience: app.userProfile.yearsOfExperience,
      professionalSummary: app.userProfile.professionalSummary,
      skills: app.userProfile.skills.map((s) => ({ name: s.name, category: s.category })),
      experience: app.userProfile.experiences.map((e) => ({
        id: e.id,
        company: e.company,
        jobTitle: e.jobTitle,
        startDate: e.startDate ? e.startDate.toISOString().slice(0, 7) : null,
        endDate: e.endDate ? e.endDate.toISOString().slice(0, 7) : null,
        isCurrent: e.isCurrent,
        description: e.description,
      })),
      education: app.userProfile.education.map((ed) => ({
        institution: ed.institution,
        degree: ed.degree,
        fieldOfStudy: ed.fieldOfStudy,
      })),
    };

    const jobInput = {
      id: app.job.id,
      title: app.job.title,
      company: app.job.companyName,
      description: app.job.description,
      location: app.job.location,
      workMode: app.job.workMode,
      employmentType: app.job.employmentType,
      experienceLevel: app.job.experienceLevel,
    };

    const genResult = await this.generator.generateAnswers(candidateInput, jobInput, questions);

    // Save each generated answer
    const savedAnswers = [];
    for (const item of genResult.data.answers) {
      const saved = await prisma.applicationAnswer.create({
        data: {
          applicationId: id,
          question: item.question,
          answer: item.answer,
          originalAnswer: item.answer,
          source: 'AI_GENERATED',
        },
      });
      savedAnswers.push(saved);
    }

    await prisma.application.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    return {
      answers: savedAnswers.map((a) => ({
        ...a,
        source: a.source as any,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
      validation: genResult.validation,
    };
  }

  /**
   * Human edit update: updates document or answer content and marks source as USER_EDITED
   */
  async updateApplication(id: string, input: UpdateApplicationInput): Promise<ApplicationWorkspace> {
    const app = await prisma.application.findUnique({
      where: { id },
      include: { documents: true, answers: true },
    });

    if (!app) {
      throw new ApplicationNotFoundError(id);
    }

    // Update documents
    if (input.documents) {
      for (const docInput of input.documents) {
        const existing = app.documents.find((d) => d.type === docInput.type);
        if (existing) {
          await prisma.applicationDocument.update({
            where: { id: existing.id },
            data: {
              content: docInput.content,
              originalContent: existing.originalContent || existing.content,
              source: 'USER_EDITED',
            },
          });
        } else {
          await prisma.applicationDocument.create({
            data: {
              applicationId: id,
              type: docInput.type,
              content: docInput.content,
              originalContent: docInput.content,
              source: 'USER_EDITED',
            },
          });
        }
      }
    }

    // Update answers
    if (input.answers) {
      for (const ansInput of input.answers) {
        if (ansInput.id) {
          const existing = app.answers.find((a) => a.id === ansInput.id);
          if (existing) {
            await prisma.applicationAnswer.update({
              where: { id: ansInput.id },
              data: {
                answer: ansInput.answer,
                originalAnswer: existing.originalAnswer || existing.answer,
                source: 'USER_EDITED',
                ...(ansInput.question ? { question: ansInput.question } : {}),
              },
            });
          }
        } else if (ansInput.question) {
          await prisma.applicationAnswer.create({
            data: {
              applicationId: id,
              question: ansInput.question,
              answer: ansInput.answer,
              originalAnswer: ansInput.answer,
              source: 'USER_EDITED',
            },
          });
        }
      }
    }

    await prisma.application.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    return this.getApplicationWorkspace(id);
  }

  /**
   * Transition: DRAFT -> IN_REVIEW
   */
  async reviewApplication(id: string): Promise<ApplicationWorkspace> {
    const app = await prisma.application.findUnique({ where: { id } });
    if (!app) {
      throw new ApplicationNotFoundError(id);
    }

    if (app.status !== 'DRAFT') {
      throw new InvalidStateTransitionError(
        app.status,
        'IN_REVIEW',
        `Cannot start review for application in "${app.status}" status. Only DRAFT applications can transition to IN_REVIEW.`
      );
    }

    await prisma.application.update({
      where: { id },
      data: { status: 'IN_REVIEW' },
    });

    return this.getApplicationWorkspace(id);
  }

  /**
   * Transition: IN_REVIEW -> APPROVED
   */
  async approveApplication(id: string): Promise<ApplicationWorkspace> {
    const app = await prisma.application.findUnique({ where: { id } });
    if (!app) {
      throw new ApplicationNotFoundError(id);
    }

    if (app.status !== 'IN_REVIEW') {
      throw new InvalidStateTransitionError(
        app.status,
        'APPROVED',
        `Cannot approve application in "${app.status}" status. Applications must be in IN_REVIEW status before human approval.`
      );
    }

    await prisma.application.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        rejectionReason: null,
      },
    });

    return this.getApplicationWorkspace(id);
  }

  /**
   * Transition: IN_REVIEW -> REJECTED
   */
  async rejectApplication(id: string, reason: string): Promise<ApplicationWorkspace> {
    const app = await prisma.application.findUnique({ where: { id } });
    if (!app) {
      throw new ApplicationNotFoundError(id);
    }

    if (app.status !== 'IN_REVIEW') {
      throw new InvalidStateTransitionError(
        app.status,
        'REJECTED',
        `Cannot reject application in "${app.status}" status. Applications must be in IN_REVIEW status before rejection.`
      );
    }

    await prisma.application.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason || 'Rejected by candidate during review.',
      },
    });

    return this.getApplicationWorkspace(id);
  }

  /**
   * Export Application package locally:
   * Generates application-summary.txt, cover-letter.txt, answers.json, resume-bullet-suggestions.txt.
   * Transitions status to EXPORTED.
   * Does NOT submit externally!
   */
  async exportApplication(id: string): Promise<ApplicationExportResponse> {
    const workspace = await this.getApplicationWorkspace(id);
    const { application, job, answers, documents } = workspace;

    const exportDir = path.resolve(this.exportBaseDir, id);
    await fs.mkdir(exportDir, { recursive: true });

    const files: ApplicationExportFile[] = [];

    // 1. application-summary.txt
    const summaryContent =
      documents.APPLICATION_SUMMARY?.content ||
      `Application Summary\nJob: ${job.title} at ${job.companyName}\nStatus: ${application.status}\nCreated: ${application.createdAt}`;
    const summaryPath = path.join(exportDir, 'application-summary.txt');
    await fs.writeFile(summaryPath, summaryContent, 'utf-8');
    const summaryStat = await fs.stat(summaryPath);
    files.push({
      name: 'application-summary.txt',
      path: summaryPath,
      sizeBytes: summaryStat.size,
    });

    // 2. cover-letter.txt
    const coverLetterContent = documents.COVER_LETTER?.content || 'No cover letter generated.';
    const coverPath = path.join(exportDir, 'cover-letter.txt');
    await fs.writeFile(coverPath, coverLetterContent, 'utf-8');
    const coverStat = await fs.stat(coverPath);
    files.push({
      name: 'cover-letter.txt',
      path: coverPath,
      sizeBytes: coverStat.size,
    });

    // 3. resume-bullet-suggestions.txt
    const bulletsContent =
      documents.RESUME_BULLETS?.content || 'No resume bullet suggestions generated.';
    const bulletsPath = path.join(exportDir, 'resume-bullet-suggestions.txt');
    await fs.writeFile(bulletsPath, bulletsContent, 'utf-8');
    const bulletsStat = await fs.stat(bulletsPath);
    files.push({
      name: 'resume-bullet-suggestions.txt',
      path: bulletsPath,
      sizeBytes: bulletsStat.size,
    });

    // 4. answers.json
    const answersData = answers.map((a) => ({
      question: a.question,
      answer: a.answer,
      source: a.source,
      originalAnswer: a.originalAnswer || a.answer,
      updatedAt: a.updatedAt,
    }));
    const answersContent = JSON.stringify(answersData, null, 2);
    const answersPath = path.join(exportDir, 'answers.json');
    await fs.writeFile(answersPath, answersContent, 'utf-8');
    const answersStat = await fs.stat(answersPath);
    files.push({
      name: 'answers.json',
      path: answersPath,
      sizeBytes: answersStat.size,
    });

    // Transition status to EXPORTED
    await prisma.application.update({
      where: { id },
      data: { status: 'EXPORTED' },
    });

    return {
      applicationId: id,
      exportDirectory: exportDir,
      files,
      exportedAt: new Date().toISOString(),
    };
  }
}

export const applicationService = new ApplicationService();
