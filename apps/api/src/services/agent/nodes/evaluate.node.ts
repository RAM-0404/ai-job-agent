import { prisma } from '../../../db/prisma.js';
import type { AgentState, AgentStateUpdate } from '../agent.state.js';
import { jobMatchService, type JobMatchService } from '../../matching/job-match.service.js';

/**
 * Creates an Evaluate Node function with injectable JobMatchService.
 *
 * Milestone 9.2:
 * Connects the agent directly to the existing M7 JobMatchService.
 * - Invokes M7 matching service (deterministic + AI evaluation).
 * - Records append-only AgentRunEvent entries:
 *     - EVALUATION_STARTED
 *     - MATCH_STARTED
 *     - MATCH_COMPLETED (with score and recommendation metadata)
 *     - AGENT_CONTINUED (if APPLY or CONSIDER)
 *     - AGENT_STOPPED (if LOW_PRIORITY or DO_NOT_APPLY)
 *     - MATCH_FAILED (if technical error occurs)
 * - Deterministic routing:
 *     - APPLY / CONSIDER -> decision = 'CONTINUE' (routes to HUMAN_REVIEW)
 *     - LOW_PRIORITY / DO_NOT_APPLY -> decision = 'STOP' (routes to COMPLETE)
 * - Safe technical error handling -> status = 'FAILED', decision = 'STOP'
 */
export function createEvaluateNode(
  matchService: Pick<JobMatchService, 'matchJob'> = jobMatchService
) {
  return async function evaluateNode(state: AgentState): Promise<AgentStateUpdate> {
    // If state was already failed in previous node, pass-through
    if (state.status === 'FAILED') {
      return {
        currentStep: 'FAILED',
        status: 'FAILED',
        decision: 'STOP',
      };
    }

    if (!state.jobId) {
      const errorMsg = 'Cannot evaluate match: jobId is missing from agent run.';
      await prisma.agentRunEvent.create({
        data: {
          agentRunId: state.runId,
          step: 'EVALUATE',
          eventType: 'MATCH_FAILED',
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

    // 1. Record EVALUATION_STARTED event
    await prisma.agentRunEvent.create({
      data: {
        agentRunId: state.runId,
        step: 'EVALUATE',
        eventType: 'EVALUATION_STARTED',
        message: 'Job evaluation initiated.',
      },
    });

    // 2. Record MATCH_STARTED event
    await prisma.agentRunEvent.create({
      data: {
        agentRunId: state.runId,
        step: 'EVALUATE',
        eventType: 'MATCH_STARTED',
        message: 'Invoking M7 job matching service.',
      },
    });

    try {
      // 3. Invoke existing M7 matching service
      const matchResult = await matchService.matchJob(state.jobId, state.userProfileId);
      const score = matchResult.overallScore;
      const recommendation = matchResult.recommendation;

      // 4. Record MATCH_COMPLETED event
      await prisma.agentRunEvent.create({
        data: {
          agentRunId: state.runId,
          step: 'EVALUATE',
          eventType: 'MATCH_COMPLETED',
          message: `M7 matching completed with score ${score}% (${recommendation}).`,
          metadata: {
            score,
            recommendation,
          },
        },
      });

      // 5. Evaluate Recommendation Routing
      const shouldProceed = recommendation === 'APPLY' || recommendation === 'CONSIDER';

      if (shouldProceed) {
        // High quality match -> Proceed toward human review
        await prisma.agentRunEvent.create({
          data: {
            agentRunId: state.runId,
            step: 'EVALUATE',
            eventType: 'AGENT_CONTINUED',
            message: `Compatibility recommendation is "${recommendation}". Proceeding to application generation.`,
          },
        });

        return {
          currentStep: 'EVALUATE',
          status: 'RUNNING',
          decision: 'CONTINUE',
          matchScore: score,
          matchRecommendation: recommendation,
          metadata: {
            ...state.metadata,
            evaluatedAt: new Date().toISOString(),
            recommendation,
            matchScore: score,
          },
          timestamps: {
            startedAt: state.timestamps?.startedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      } else {
        // Low quality match (LOW_PRIORITY or DO_NOT_APPLY) -> Terminate workflow normally
        await prisma.agentRunEvent.create({
          data: {
            agentRunId: state.runId,
            step: 'EVALUATE',
            eventType: 'AGENT_STOPPED',
            message: `Compatibility recommendation is "${recommendation}". Stopping agent workflow.`,
            metadata: {
              score,
              recommendation,
            },
          },
        });

        return {
          currentStep: 'EVALUATE',
          status: 'RUNNING',
          decision: 'STOP',
          matchScore: score,
          matchRecommendation: recommendation,
          metadata: {
            ...state.metadata,
            evaluatedAt: new Date().toISOString(),
            recommendation,
            matchScore: score,
            stoppedReason: `Recommendation "${recommendation}" does not meet threshold for human review.`,
          },
          timestamps: {
            startedAt: state.timestamps?.startedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      }
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : 'Job matching failed unexpectedly.';

      await prisma.agentRunEvent.create({
        data: {
          agentRunId: state.runId,
          step: 'EVALUATE',
          eventType: 'MATCH_FAILED',
          message: `Job matching failed: ${errorMessage}`,
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

export const evaluateNode = createEvaluateNode(jobMatchService);
