import { prisma } from '../../../db/prisma.js';
import type { AgentState, AgentStateUpdate } from '../agent.state.js';
import {
  applicationValidationService,
  type ApplicationValidationService,
} from '../../applications/application-validation.service.js';

export type ApplicationValidationDependencies = Pick<
  ApplicationValidationService,
  'validateApplicationMaterials'
>;

/**
 * Creates an Application Validation Node function with injectable ApplicationValidationService.
 *
 * Milestone 9.3:
 * Connects the agent directly to the existing M8 Fact Validation service.
 * - Loads generated Application materials and candidate verified profile facts.
 * - Invokes M8 FactValidationService (checking years, employers, certifications, leadership, metrics).
 * - Distinguishes between:
 *     - Hard validation failure (suspicious claims / isValid: false) -> halts workflow (FAILED, STOP).
 *     - Reviewable validation warnings (warnings present, isValid: true) -> preserves warnings, advances to HUMAN_REVIEW.
 *     - Clean validation pass (no warnings, isValid: true) -> advances to HUMAN_REVIEW.
 * - Records append-only AgentRunEvent entries:
 *     - APPLICATION_VALIDATION:STARTED
 *     - APPLICATION_VALIDATION:PASSED (if clean)
 *     - APPLICATION_VALIDATION:WARNINGS (if reviewable warnings)
 *     - APPLICATION_VALIDATION:FAILED (if hard failure or unexpected error)
 * - CRITICAL SAFETY: The agent NEVER approves generated content; human approval remains mandatory.
 */
export function createApplicationValidationNode(
  validationService: ApplicationValidationDependencies = applicationValidationService
) {
  return async function applicationValidationNode(state: AgentState): Promise<AgentStateUpdate> {
    // If state was already failed in previous node, pass-through
    if (state.status === 'FAILED') {
      return {
        currentStep: 'FAILED',
        status: 'FAILED',
        decision: 'STOP',
      };
    }

    const applicationId = state.applicationId;
    if (!applicationId) {
      const errorMsg = 'Cannot validate application: missing applicationId in agent state.';
      await prisma.agentRunEvent.create({
        data: {
          agentRunId: state.runId,
          step: 'VALIDATE_APPLICATION',
          eventType: 'APPLICATION_VALIDATION:FAILED',
          message: errorMsg,
        },
      });

      return {
        currentStep: 'FAILED',
        status: 'FAILED',
        decision: 'STOP',
        errors: [errorMsg],
        timestamps: {
          startedAt: state.timestamps?.startedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    }

    // 1. Record APPLICATION_VALIDATION:STARTED event
    await prisma.agentRunEvent.create({
      data: {
        agentRunId: state.runId,
        step: 'VALIDATE_APPLICATION',
        eventType: 'APPLICATION_VALIDATION:STARTED',
        message: 'Fact validation initiated on generated application materials.',
      },
    });

    try {
      // 2. Load application materials and relations from DB
      const app = await prisma.application.findUnique({
        where: { id: applicationId },
        include: {
          job: true,
          userProfile: {
            include: {
              skills: true,
              experiences: true,
              education: true,
            },
          },
          documents: true,
        },
      });

      if (!app) {
        throw new Error(`Application with ID "${applicationId}" was not found.`);
      }

      // 3. Prepare inputs for M8 validation service
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

      const summaryDoc = app.documents.find((d) => d.type === 'APPLICATION_SUMMARY');
      const coverLetterDoc = app.documents.find((d) => d.type === 'COVER_LETTER');
      const resumeBulletsDoc = app.documents.find((d) => d.type === 'RESUME_BULLETS');

      const bulletLines = (resumeBulletsDoc?.content || '')
        .split('\n')
        .map((b) => b.replace(/^[-*•]\s*/, '').trim())
        .filter(Boolean)
        .map((bullet) => ({ bullet }));

      // 4. Run existing M8 Fact Validation
      const validationResult = validationService.validateApplicationMaterials(
        candidateInput,
        jobInput,
        {
          summary: summaryDoc?.content,
          coverLetter: coverLetterDoc?.content,
          resumeBullets: bulletLines,
        }
      );

      // 5. Check validation outcome
      const hasHardFailure = !validationResult.isValid || validationResult.suspiciousClaims.length > 0;

      if (hasHardFailure) {
        // Hard failure: hallucination / unsupported claims detected
        const failMessage = `Fact validation failed with ${validationResult.suspiciousClaims.length} suspicious claim(s): ${validationResult.suspiciousClaims.join('; ')}`;

        await prisma.agentRunEvent.create({
          data: {
            agentRunId: state.runId,
            step: 'VALIDATE_APPLICATION',
            eventType: 'APPLICATION_VALIDATION:FAILED',
            message: failMessage,
            metadata: {
              suspiciousClaims: validationResult.suspiciousClaims,
              warnings: validationResult.warnings,
            },
          },
        });

        return {
          currentStep: 'FAILED',
          status: 'FAILED',
          decision: 'STOP',
          applicationValidated: true,
          validationPassed: false,
          errors: validationResult.suspiciousClaims,
          timestamps: {
            startedAt: state.timestamps?.startedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      }

      if (validationResult.warnings.length > 0) {
        // Reviewable warnings: warnings exist but no hard hallucinations
        const warnMessage = `Fact validation passed with ${validationResult.warnings.length} reviewable warning(s): ${validationResult.warnings.join('; ')}`;

        await prisma.agentRunEvent.create({
          data: {
            agentRunId: state.runId,
            step: 'VALIDATE_APPLICATION',
            eventType: 'APPLICATION_VALIDATION:WARNINGS',
            message: warnMessage,
            metadata: {
              warnings: validationResult.warnings,
            },
          },
        });

        return {
          currentStep: 'VALIDATE_APPLICATION',
          status: 'RUNNING',
          decision: 'CONTINUE',
          applicationValidated: true,
          validationPassed: true,
          warnings: validationResult.warnings,
          validationWarnings: validationResult.warnings,
          timestamps: {
            startedAt: state.timestamps?.startedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      }

      // Clean validation pass
      await prisma.agentRunEvent.create({
        data: {
          agentRunId: state.runId,
          step: 'VALIDATE_APPLICATION',
          eventType: 'APPLICATION_VALIDATION:PASSED',
          message: 'Fact validation passed cleanly with zero warnings or suspicious claims.',
        },
      });

      return {
        currentStep: 'VALIDATE_APPLICATION',
        status: 'RUNNING',
        decision: 'CONTINUE',
        applicationValidated: true,
        validationPassed: true,
        timestamps: {
          startedAt: state.timestamps?.startedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : 'Application validation failed unexpectedly.';

      await prisma.agentRunEvent.create({
        data: {
          agentRunId: state.runId,
          step: 'VALIDATE_APPLICATION',
          eventType: 'APPLICATION_VALIDATION:FAILED',
          message: `Application validation error: ${errorMessage}`,
        },
      });

      return {
        currentStep: 'FAILED',
        status: 'FAILED',
        decision: 'STOP',
        errors: [errorMessage],
        timestamps: {
          startedAt: state.timestamps?.startedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    }
  };
}

export const applicationValidationNode = createApplicationValidationNode(applicationValidationService);
