import { prisma } from '../../../db/prisma.js';
import type { AgentState, AgentStateUpdate } from '../agent.state.js';

/**
 * Complete Node (Milestone 9.1 & 9.2 Completion)
 *
 * Finalizes the agent run:
 * - If arriving from low-score stop path (decision = 'STOP'):
 *     - Retains decision = 'STOP'
 *     - Sets status = 'COMPLETED'
 *     - Sets currentStep = 'COMPLETED'
 *     - Records COMPLETED event
 *     - Sets completedAt timestamp
 * - If arriving following human approval (continuation phase):
 *     - Sets status = 'COMPLETED'
 *     - Sets currentStep = 'COMPLETED'
 *     - Sets decision = 'APPROVED'
 *     - Sets completedAt timestamp
 */
export async function completeNode(state: AgentState): Promise<AgentStateUpdate> {
  const completedAt = new Date().toISOString();
  const isStopDecision = state.decision === 'STOP';
  const finalDecision = isStopDecision ? 'STOP' : 'APPROVED';
  const notes = isStopDecision
    ? 'Agent run completed with STOP decision.'
    : 'Agent run completed successfully following human approval.';

  if (isStopDecision) {
    await prisma.agentRunEvent.create({
      data: {
        agentRunId: state.runId,
        step: 'COMPLETED',
        eventType: 'COMPLETED',
        message: notes,
      },
    });
  }

  return {
    currentStep: 'COMPLETED',
    status: 'COMPLETED',
    decision: finalDecision,
    requiresHumanApproval: false,
    metadata: {
      ...state.metadata,
      completedAt,
      completionNotes: notes,
    },
    timestamps: {
      startedAt: state.timestamps?.startedAt || new Date().toISOString(),
      completedAt,
      updatedAt: completedAt,
    },
  };
}
