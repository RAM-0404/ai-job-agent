import { prisma } from '../../../db/prisma.js';
import type { AgentState, AgentStateUpdate } from '../agent.state.js';
import { applicationService, type ApplicationService } from '../../applications/application.service.js';

export type ApplicationServiceDependencies = Pick<
  ApplicationService,
  'createOrGetApplication' | 'generateApplicationContent' | 'getApplicationWorkspace'
>;

/**
 * Creates an Application Generation Node function with injectable ApplicationService.
 *
 * Milestone 9.3:
 * Connects the agent directly to the existing M8 ApplicationService.
 * - Confirms valid userProfileId and jobId.
 * - Idempotently creates or reuses existing Application record for (jobId, userProfileId).
 * - Protects user-edited documents and answers (source === 'USER_EDITED').
 * - Avoids redundant AI generation if application materials are already generated.
 * - Triggers M8 Application content generation when materials do not yet exist.
 * - Records append-only AgentRunEvent entries:
 *     - APPLICATION_GENERATION:STARTED
 *     - APPLICATION_GENERATION:COMPLETED
 *     - APPLICATION_GENERATION:FAILED (if error occurs)
 * - Safe technical error handling -> status = 'FAILED', decision = 'STOP'
 */
export function createApplicationGenerationNode(
  appService: ApplicationServiceDependencies = applicationService
) {
  return async function applicationGenerationNode(state: AgentState): Promise<AgentStateUpdate> {
    // If state was already failed in previous node, pass-through
    if (state.status === 'FAILED') {
      return {
        currentStep: 'FAILED',
        status: 'FAILED',
        decision: 'STOP',
      };
    }

    // 1. Confirm valid userProfileId and jobId
    if (!state.userProfileId || !state.jobId) {
      const errorMsg = 'Cannot generate application: missing userProfileId or jobId.';
      await prisma.agentRunEvent.create({
        data: {
          agentRunId: state.runId,
          step: 'GENERATE_APPLICATION',
          eventType: 'APPLICATION_GENERATION:FAILED',
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

    try {
      // 2. Record APPLICATION_GENERATION:STARTED event
      await prisma.agentRunEvent.create({
        data: {
          agentRunId: state.runId,
          step: 'GENERATE_APPLICATION',
          eventType: 'APPLICATION_GENERATION:STARTED',
          message: 'Application generation initiated for job and candidate profile.',
        },
      });

      // 3. Create or reuse existing Application record (Unique per jobId + userProfileId)
      const workspace = await appService.createOrGetApplication(state.jobId, state.userProfileId);
      const appRecord = workspace.application;

      // 4. Check existing content for user-edit protection and idempotency
      const existingDocs = await prisma.applicationDocument.findMany({
        where: { applicationId: appRecord.id },
      });
      const existingAnswers = await prisma.applicationAnswer.findMany({
        where: { applicationId: appRecord.id },
      });

      const hasUserEditedDocs = existingDocs.some((d) => d.source === 'USER_EDITED');
      const hasUserEditedAnswers = existingAnswers.some((a) => a.source === 'USER_EDITED');
      const hasCoverLetter = existingDocs.some((d) => d.type === 'COVER_LETTER' && d.content.trim().length > 0);
      const hasResumeBullets = existingDocs.some((d) => d.type === 'RESUME_BULLETS' && d.content.trim().length > 0);
      const hasSummary = existingDocs.some((d) => d.type === 'APPLICATION_SUMMARY' && d.content.trim().length > 0);

      const allMaterialsPresent = hasCoverLetter && hasResumeBullets && hasSummary;
      let reused = false;

      if (hasUserEditedDocs || hasUserEditedAnswers) {
        // User has manually edited content: protect user edits from automatic regeneration
        reused = true;
        await prisma.agentRunEvent.create({
          data: {
            agentRunId: state.runId,
            step: 'GENERATE_APPLICATION',
            eventType: 'APPLICATION_GENERATION:COMPLETED',
            message: 'Existing application workspace reused; candidate manual edits preserved.',
            metadata: {
              applicationId: appRecord.id,
              reused: true,
              userEdited: true,
            },
          },
        });
      } else if (allMaterialsPresent) {
        // Application materials already generated from a prior run: reuse idempotently
        reused = true;
        await prisma.agentRunEvent.create({
          data: {
            agentRunId: state.runId,
            step: 'GENERATE_APPLICATION',
            eventType: 'APPLICATION_GENERATION:COMPLETED',
            message: 'Existing application workspace reused idempotently; skipping duplicate AI generation.',
            metadata: {
              applicationId: appRecord.id,
              reused: true,
            },
          },
        });
      } else {
        // Generation required: invoke existing M8 ApplicationService generator
        await appService.generateApplicationContent(appRecord.id);

        await prisma.agentRunEvent.create({
          data: {
            agentRunId: state.runId,
            step: 'GENERATE_APPLICATION',
            eventType: 'APPLICATION_GENERATION:COMPLETED',
            message: 'Application materials (summary, cover letter, resume bullets) generated successfully.',
            metadata: {
              applicationId: appRecord.id,
              reused: false,
            },
          },
        });
      }

      return {
        applicationId: appRecord.id,
        applicationGenerated: true,
        currentStep: 'GENERATE_APPLICATION',
        status: 'RUNNING',
        decision: 'CONTINUE',
        metadata: {
          ...state.metadata,
          applicationId: appRecord.id,
          applicationReused: reused,
          generatedAt: new Date().toISOString(),
        },
        timestamps: {
          startedAt: state.timestamps?.startedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : 'Application generation failed unexpectedly.';

      await prisma.agentRunEvent.create({
        data: {
          agentRunId: state.runId,
          step: 'GENERATE_APPLICATION',
          eventType: 'APPLICATION_GENERATION:FAILED',
          message: `Application generation failed: ${errorMessage}`,
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

export const applicationGenerationNode = createApplicationGenerationNode(applicationService);
