import { prisma } from '../../../db/prisma.js';
import type { AgentState, AgentStateUpdate } from '../agent.state.js';

/**
 * Human Review Node (Milestone 9.1 Checkpoint)
 *
 * Enforces the mandatory Human-in-the-Loop checkpoint:
 * - Sets status = 'WAITING_FOR_HUMAN'
 * - Sets currentStep = 'HUMAN_REVIEW'
 * - Sets requiresHumanApproval = true
 * - Sets decision = 'WAIT_FOR_HUMAN'
 *
 * CRITICAL SAFETY RULES:
 * - The agent MUST NEVER automatically approve.
 * - The agent MUST NEVER automatically submit.
 * - The workflow strictly halts at this node until human interaction occurs.
 */
export async function humanReviewNode(state: AgentState): Promise<AgentStateUpdate> {
  // If state was already failed in previous node, pass-through
  if (state.status === 'FAILED') {
    return {
      currentStep: 'FAILED',
      status: 'FAILED',
      decision: 'STOP',
    };
  }

  await prisma.agentRunEvent.create({
    data: {
      agentRunId: state.runId,
      step: 'HUMAN_REVIEW',
      eventType: 'WAITING',
      message: 'Agent reached mandatory human review checkpoint. Waiting for candidate approval.',
      metadata: {
        matchScore: state.matchScore,
        matchRecommendation: state.matchRecommendation,
      },
    },
  });

  return {
    currentStep: 'HUMAN_REVIEW',
    status: 'WAITING_FOR_HUMAN',
    requiresHumanApproval: true,
    decision: 'WAIT_FOR_HUMAN',
    metadata: {
      ...state.metadata,
      humanReviewRequestedAt: new Date().toISOString(),
      checkpointReason: 'Mandatory human approval required before proceeding.',
    },
    timestamps: {
      startedAt: state.timestamps?.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}
