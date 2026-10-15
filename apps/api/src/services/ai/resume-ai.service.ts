import { prisma } from '../../db/prisma.js';
import { config } from '../../config/env.js';
import { ollamaService, OllamaService } from './ollama.service.js';
import { RESUME_ANALYSIS_SYSTEM_PROMPT } from './prompts/resume-analysis.system.js';
import { buildResumeAnalysisUserPrompt } from './prompts/resume-analysis.user.js';
import {
  ResumeAIProfileSchema,
  RESUME_JSON_SCHEMA,
  type ValidatedResumeAIProfile,
} from './schema/resume-ai.schema.js';
import type { ResumeAnalysisResponse } from '@ai-job-agent/shared';

export class ResumeNoTextError extends Error {
  constructor(message = 'Resume contains no extracted plain text to analyze.') {
    super(message);
    this.name = 'ResumeNoTextError';
  }
}

export class ResumeTextTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResumeTextTooLargeError';
  }
}

export class AIOutputValidationError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'AIOutputValidationError';
  }
}

/**
 * Safely parses human or AI date strings into JavaScript Date objects
 */
export function parseDateString(dateStr: string | null | undefined): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (lower === 'present' || lower === 'current' || lower === 'now' || lower === 'ongoing') {
    return null;
  }

  // Format: YYYY (e.g. "2021")
  if (/^\d{4}$/.test(trimmed)) {
    return new Date(`${trimmed}-01-01T00:00:00.000Z`);
  }

  // Format: YYYY-MM (e.g. "2021-05")
  const yyyyMmMatch = /^(\d{4})-(\d{1,2})$/.exec(trimmed);
  if (yyyyMmMatch) {
    const year = yyyyMmMatch[1];
    const month = yyyyMmMatch[2].padStart(2, '0');
    return new Date(`${year}-${month}-01T00:00:00.000Z`);
  }

  // Format: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T00:00:00.000Z`);
  }

  // Standard date parsing fallback
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

export class ResumeAIService {
  constructor(private readonly aiClient: OllamaService = ollamaService) {}

  /**
   * Analyzes raw resume text with Ollama, validates schema, and returns structured data
   */
  async extractProfileFromText(rawText: string | null | undefined): Promise<ValidatedResumeAIProfile> {
    if (!rawText || rawText.trim().length === 0) {
      throw new ResumeNoTextError('Resume contains no extracted plain text to analyze.');
    }

    const trimmedText = rawText.trim();
    if (trimmedText.length > config.maxAiResumeChars) {
      throw new ResumeTextTooLargeError(
        `Resume text length (${trimmedText.length} characters) exceeds the maximum allowed limit of ${config.maxAiResumeChars} characters for AI analysis.`
      );
    }

    const systemPrompt = RESUME_ANALYSIS_SYSTEM_PROMPT;
    const userPrompt = buildResumeAnalysisUserPrompt(trimmedText);

    const rawResult = await this.aiClient.generateStructured<unknown>(
      systemPrompt,
      userPrompt,
      RESUME_JSON_SCHEMA
    );

    const parseResult = ResumeAIProfileSchema.safeParse(rawResult);
    if (!parseResult.success) {
      throw new AIOutputValidationError(
        'AI output failed schema validation',
        parseResult.error.format()
      );
    }

    return parseResult.data;
  }

  /**
   * Persists validated AI profile data into PostgreSQL for the given user profile.
   * Uses a database transaction and prevents duplicate records on re-analysis.
   */
  async persistAnalysisData(
    userProfileId: string,
    resumeId: string,
    extracted: ValidatedResumeAIProfile
  ): Promise<ResumeAnalysisResponse> {
    await prisma.$transaction(async (tx) => {
      // 1. Update UserProfile with extracted summary, title, and years of experience
      const updateData: {
        professionalSummary?: string | null;
        currentTitle?: string | null;
        yearsOfExperience?: number | null;
      } = {};

      if (extracted.professionalSummary !== null) {
        updateData.professionalSummary = extracted.professionalSummary;
      }
      if (extracted.currentTitle !== null) {
        updateData.currentTitle = extracted.currentTitle;
      }
      if (extracted.yearsOfExperience !== null) {
        updateData.yearsOfExperience = extracted.yearsOfExperience;
      }

      if (Object.keys(updateData).length > 0) {
        await tx.userProfile.update({
          where: { id: userProfileId },
          data: updateData,
        });
      }

      // 2. Persist Skills without creating duplicates
      if (extracted.skills && extracted.skills.length > 0) {
        const existingSkills = await tx.skill.findMany({
          where: { userProfileId },
        });

        const skillMap = new Map(
          existingSkills.map((s) => [s.name.toLowerCase().trim(), s])
        );

        for (const skill of extracted.skills) {
          const normalized = skill.name.toLowerCase().trim();
          const existing = skillMap.get(normalized);

          if (existing) {
            // Update category or proficiency if new information is provided
            const needsUpdate =
              (!existing.category && skill.category) ||
              (!existing.proficiency && skill.proficiency);

            if (needsUpdate) {
              await tx.skill.update({
                where: { id: existing.id },
                data: {
                  category: existing.category || skill.category,
                  proficiency: existing.proficiency || skill.proficiency,
                },
              });
            }
          } else {
            const created = await tx.skill.create({
              data: {
                userProfileId,
                name: skill.name,
                category: skill.category,
                proficiency: skill.proficiency,
              },
            });
            skillMap.set(normalized, created);
          }
        }
      }

      // 3. Persist Experience records (match on company + jobTitle to avoid duplicates)
      if (extracted.experience && extracted.experience.length > 0) {
        const existingExperiences = await tx.experience.findMany({
          where: { userProfileId },
        });

        const expMap = new Map(
          existingExperiences.map((e) => [
            `${e.company.toLowerCase().trim()}|${e.jobTitle.toLowerCase().trim()}`,
            e,
          ])
        );

        for (const exp of extracted.experience) {
          const key = `${exp.company.toLowerCase().trim()}|${exp.jobTitle.toLowerCase().trim()}`;
          const existing = expMap.get(key);

          const parsedStart = parseDateString(exp.startDate) || new Date('2000-01-01T00:00:00.000Z');
          const parsedEnd = parseDateString(exp.endDate);

          if (existing) {
            await tx.experience.update({
              where: { id: existing.id },
              data: {
                startDate: parsedStart,
                endDate: parsedEnd,
                isCurrent: exp.isCurrent,
                description: exp.description || existing.description,
              },
            });
          } else {
            const created = await tx.experience.create({
              data: {
                userProfileId,
                company: exp.company,
                jobTitle: exp.jobTitle,
                startDate: parsedStart,
                endDate: parsedEnd,
                isCurrent: exp.isCurrent,
                description: exp.description,
              },
            });
            expMap.set(key, created);
          }
        }
      }

      // 4. Persist Education records (match on institution + degree to avoid duplicates)
      if (extracted.education && extracted.education.length > 0) {
        const existingEducations = await tx.education.findMany({
          where: { userProfileId },
        });

        const eduMap = new Map(
          existingEducations.map((e) => [
            `${e.institution.toLowerCase().trim()}|${(e.degree || '').toLowerCase().trim()}`,
            e,
          ])
        );

        for (const edu of extracted.education) {
          const key = `${edu.institution.toLowerCase().trim()}|${(edu.degree || '').toLowerCase().trim()}`;
          const existing = eduMap.get(key);

          const parsedStart = parseDateString(edu.startDate);
          const parsedEnd = parseDateString(edu.endDate);

          if (existing) {
            await tx.education.update({
              where: { id: existing.id },
              data: {
                fieldOfStudy: edu.fieldOfStudy || existing.fieldOfStudy,
                startDate: parsedStart || existing.startDate,
                endDate: parsedEnd || existing.endDate,
                description: edu.description || existing.description,
              },
            });
          } else {
            const created = await tx.education.create({
              data: {
                userProfileId,
                institution: edu.institution,
                degree: edu.degree,
                fieldOfStudy: edu.fieldOfStudy,
                startDate: parsedStart,
                endDate: parsedEnd,
                description: edu.description,
              },
            });
            eduMap.set(key, created);
          }
        }
      }
    });

    // 5. Build structured response
    return {
      resumeId,
      status: 'analyzed',
      profile: {
        professionalSummary: extracted.professionalSummary,
        currentTitle: extracted.currentTitle,
        yearsOfExperience: extracted.yearsOfExperience,
      },
      counts: {
        skills: extracted.skills.length,
        experience: extracted.experience.length,
        education: extracted.education.length,
        projects: extracted.projects.length,
        certifications: extracted.certifications.length,
      },
    };
  }

  /**
   * Coordinates full resume analysis workflow: fetching, extraction, and persistence
   */
  async analyzeResume(resumeId: string): Promise<ResumeAnalysisResponse> {
    const resume = await prisma.resume.findUnique({
      where: { id: resumeId },
    });

    if (!resume) {
      throw new Error(`Resume not found`);
    }

    const extracted = await this.extractProfileFromText(resume.rawText);
    return this.persistAnalysisData(resume.userProfileId, resume.id, extracted);
  }
}

export const resumeAIService = new ResumeAIService();
