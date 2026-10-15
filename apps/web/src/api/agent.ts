import { apiClient } from './client.js';
import type {
  AgentRunDto,
  AgentRunEventDto,
  CreateAgentRunRequest,
  CreateAgentRunResponse,
} from '@ai-job-agent/shared';

/**
 * Creates a new AgentRun in IDLE state.
 */
export async function createAgentRun(
  input: CreateAgentRunRequest = {}
): Promise<CreateAgentRunResponse> {
  return apiClient<CreateAgentRunResponse>('/agent/runs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Starts the agent workflow for a given run ID.
 */
export async function startAgentRun(runId: string): Promise<AgentRunDto> {
  return apiClient<AgentRunDto>(`/agent/runs/${runId}/start`, {
    method: 'POST',
  });
}

/**
 * Retrieves details and current status of an AgentRun.
 */
export async function getAgentRun(runId: string): Promise<AgentRunDto> {
  return apiClient<AgentRunDto>(`/agent/runs/${runId}`);
}

/**
 * Retrieves chronological append-only events for an AgentRun.
 */
export async function getAgentRunEvents(runId: string): Promise<AgentRunEventDto[]> {
  return apiClient<AgentRunEventDto[]>(`/agent/runs/${runId}/events`);
}

/**
 * Approves workflow continuation during HUMAN_REVIEW.
 */
export async function approveAgentRun(runId: string): Promise<AgentRunDto> {
  return apiClient<AgentRunDto>(`/agent/runs/${runId}/approve`, {
    method: 'POST',
  });
}

/**
 * Rejects workflow continuation during HUMAN_REVIEW.
 */
export async function rejectAgentRun(runId: string, reason?: string): Promise<AgentRunDto> {
  return apiClient<AgentRunDto>(`/agent/runs/${runId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
