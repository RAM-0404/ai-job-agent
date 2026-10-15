export class AgentRunNotFoundError extends Error {
  constructor(public readonly runId: string) {
    super(`Agent run with ID "${runId}" was not found.`);
    this.name = 'AgentRunNotFoundError';
  }
}

export class AgentContextNotFoundError extends Error {
  constructor(public readonly entityType: string, public readonly entityId: string) {
    super(`Agent context entity "${entityType}" with ID "${entityId}" was not found.`);
    this.name = 'AgentContextNotFoundError';
  }
}

export class InvalidAgentStateTransitionError extends Error {
  constructor(
    public readonly fromStatus: string,
    public readonly toStatus: string,
    message?: string
  ) {
    super(
      message ||
        `Invalid agent state transition from "${fromStatus}" to "${toStatus}". Please follow the strict agent lifecycle: IDLE -> RUNNING -> WAITING_FOR_HUMAN -> RUNNING -> COMPLETED / FAILED / CANCELLED.`
    );
    this.name = 'InvalidAgentStateTransitionError';
  }
}

export class AgentActionNotAllowedError extends Error {
  constructor(
    public readonly action: string,
    public readonly currentStatus: string,
    public readonly allowedStatus: string
  ) {
    super(
      `Cannot perform action "${action}" when agent status is "${currentStatus}". Action is only permitted when status is "${allowedStatus}".`
    );
    this.name = 'AgentActionNotAllowedError';
  }
}
