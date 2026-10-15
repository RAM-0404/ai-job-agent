export type AgentStatus =
  | 'IDLE'
  | 'RUNNING'
  | 'WAITING_FOR_HUMAN'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type AgentStep =
  | 'INITIALIZE'
  | 'LOAD_CONTEXT'
  | 'EVALUATE'
  | 'GENERATE_APPLICATION'
  | 'VALIDATE_APPLICATION'
  | 'HUMAN_REVIEW'
  | 'READY_FOR_SUBMISSION'
  | 'COMPLETED'
  | 'FAILED';

export type AgentDecision =
  | 'CONTINUE'
  | 'STOP'
  | 'WAIT_FOR_HUMAN'
  | 'APPROVED'
  | 'REJECTED';

export interface AgentRunDto {
  id: string;
  userProfileId: string;
  jobId?: string | null;
  applicationId?: string | null;
  status: AgentStatus;
  currentStep: AgentStep;
  decision?: AgentDecision | null;
  matchScore?: number | null;
  matchRecommendation?: string | null;
  applicationGenerated?: boolean;
  applicationValidated?: boolean;
  validationPassed?: boolean;
  errorMessage?: string | null;
  startedAt: string;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunEventDto {
  id: string;
  agentRunId: string;
  step: AgentStep;
  eventType: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateAgentRunRequest {
  userProfileId?: string;
  jobId?: string;
  applicationId?: string;
}

export interface CreateAgentRunResponse {
  runId: string;
  status: AgentStatus;
  currentStep: AgentStep;
}

export interface AgentTransitionRequest {
  action: 'START' | 'APPROVE' | 'REJECT';
  reason?: string;
}

export interface AgentRunDetailResponse {
  run: AgentRunDto;
  events?: AgentRunEventDto[];
}
