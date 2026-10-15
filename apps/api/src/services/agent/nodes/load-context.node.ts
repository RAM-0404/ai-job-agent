import { prisma } from '../../../db/prisma.js';
import type { AgentState, AgentStateUpdate } from '../agent.state.js';
import type { AgentContextEntities } from '../agent.types.js';

/**
 * Load Context Node (Milestone 9.1)
 *
 * Verifies that the required entities exist in PostgreSQL:
 * - Candidate UserProfile (mandatory)
 * - Target Job (mandatory if jobId provided)
 * - Existing Application (optional if applicationId provided)
 * - Existing JobMatch (optional, read if available)
 *
 * Does NOT mutate existing database records or generate AI content.
 * Fails safely if required context is missing.
 */
export async function loadContextNode(state: AgentState): Promise<AgentStateUpdate> {
  const errors: string[] = [];
  const loadedContext: AgentContextEntities = {};

  try {
    // 1. Verify User Profile
    if (!state.userProfileId) {
      errors.push('Missing userProfileId in agent state.');
      return {
        currentStep: 'FAILED',
        status: 'FAILED',
        decision: 'STOP',
        errors,
        timestamps: {
          startedAt: state.timestamps?.startedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    }

    const candidate = await prisma.userProfile.findUnique({
      where: { id: state.userProfileId },
      include: {
        skills: true,
        experiences: true,
        education: true,
      },
    });

    if (!candidate) {
      errors.push(`Candidate profile with ID "${state.userProfileId}" not found.`);
      return {
        currentStep: 'FAILED',
        status: 'FAILED',
        decision: 'STOP',
        errors,
        timestamps: {
          startedAt: state.timestamps?.startedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    }
    loadedContext.candidate = candidate;

    // 2. Verify Job (if provided)
    if (state.jobId) {
      const job = await prisma.job.findUnique({
        where: { id: state.jobId },
      });

      if (!job) {
        errors.push(`Target job with ID "${state.jobId}" not found.`);
        return {
          currentStep: 'FAILED',
          status: 'FAILED',
          decision: 'STOP',
          errors,
          timestamps: {
            startedAt: state.timestamps?.startedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      }
      loadedContext.job = job;

      // 3. Check for existing JobMatch if both profile and job are present
      const match = await prisma.jobMatch.findUnique({
        where: {
          jobId_userProfileId: {
            jobId: state.jobId,
            userProfileId: state.userProfileId,
          },
        },
      });
      if (match) {
        loadedContext.match = match;
      }
    }

    // 4. Verify Application (if provided)
    if (state.applicationId) {
      const application = await prisma.application.findUnique({
        where: { id: state.applicationId },
        include: {
          documents: true,
          answers: true,
        },
      });

      if (!application) {
        errors.push(`Application with ID "${state.applicationId}" not found.`);
        return {
          currentStep: 'FAILED',
          status: 'FAILED',
          decision: 'STOP',
          errors,
          timestamps: {
            startedAt: state.timestamps?.startedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      }
      loadedContext.application = application;
    }

    // Record completed context event
    await prisma.agentRunEvent.create({
      data: {
        agentRunId: state.runId,
        step: 'LOAD_CONTEXT',
        eventType: 'COMPLETED',
        message: 'Candidate and job context successfully loaded.',
      },
    });

    // Success transition
    return {
      currentStep: 'LOAD_CONTEXT',
      status: 'RUNNING',
      context: loadedContext,
      matchScore: loadedContext.match ? loadedContext.match.overallScore : null,
      matchRecommendation: loadedContext.match ? loadedContext.match.recommendation : null,
      timestamps: {
        startedAt: state.timestamps?.startedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unexpected context loading failure';
    errors.push(errorMsg);
    return {
      currentStep: 'FAILED',
      status: 'FAILED',
      decision: 'STOP',
      errors,
      timestamps: {
        startedAt: state.timestamps?.startedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
  }
}
