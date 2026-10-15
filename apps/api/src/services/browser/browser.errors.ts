export class BrowserNotEnabledError extends Error {
  readonly statusCode = 403;
  constructor(message = 'Browser automation is currently disabled.') {
    super(message);
    this.name = 'BrowserNotEnabledError';
  }
}

export class BrowserLaunchError extends Error {
  readonly statusCode = 500;
  constructor(message = 'Failed to launch browser instance.') {
    super(message);
    this.name = 'BrowserLaunchError';
  }
}

export class BrowserSessionNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'SESSION_NOT_FOUND';
  constructor(sessionId: string) {
    super(`Browser session "${sessionId}" was not found or has been closed.`);
    this.name = 'BrowserSessionNotFoundError';
  }
}

export class TerminalActionForbiddenError extends Error {
  readonly statusCode = 403;
  readonly code = 'TERMINAL_ACTION_FORBIDDEN';
  constructor(controlLabel: string) {
    super(`Execution of terminal action "${controlLabel}" is strictly forbidden. Final application submission is not permitted.`);
    this.name = 'TerminalActionForbiddenError';
  }
}

export class NavigationNotAllowedError extends Error {
  readonly statusCode = 400;
  readonly code = 'NAVIGATION_NOT_ALLOWED';
  constructor(reason: string) {
    super(`Navigation not allowed: ${reason}`);
    this.name = 'NavigationNotAllowedError';
  }
}

export class NavigationControlNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'CONTROL_NOT_FOUND';
  constructor(controlId: string) {
    super(`Navigation control "${controlId}" was not found on current page step.`);
    this.name = 'NavigationControlNotFoundError';
  }
}

export class NavigationStepChangedError extends Error {
  readonly statusCode = 409;
  readonly code = 'STEP_CHANGED';
  constructor(expectedStep: string, actualStep: string) {
    super(`Current step changed from "${expectedStep}" to "${actualStep}". Re-discovery required.`);
    this.name = 'NavigationStepChangedError';
  }
}

export class BrowserNavigationError extends Error {
  readonly statusCode = 500;
  constructor(message: string) {
    super(message);
    this.name = 'BrowserNavigationError';
  }
}

export class BrowserNavigationTimeoutError extends Error {
  readonly statusCode = 504;
  constructor(timeoutMs: number, url: string) {
    super(`Navigation to "${url}" timed out after ${timeoutMs}ms.`);
    this.name = 'BrowserNavigationTimeoutError';
  }
}

export class InvalidBrowserUrlError extends Error {
  readonly statusCode = 400;
  constructor(reason: string) {
    super(`Invalid URL for browser navigation: ${reason}`);
    this.name = 'InvalidBrowserUrlError';
  }
}

export class BrowserCapacityError extends Error {
  readonly statusCode = 429;
  constructor(maxContexts: number) {
    super(`Browser context capacity reached (max: ${maxContexts}). Please close an active session before creating a new one.`);
    this.name = 'BrowserCapacityError';
  }
}

export class BrowserOperationError extends Error {
  readonly statusCode = 500;
  constructor(message: string) {
    super(message);
    this.name = 'BrowserOperationError';
  }
}

export class IdempotencyConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'IDEMPOTENCY_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

export class OperationInProgressError extends Error {
  readonly statusCode = 409;
  readonly code = 'OPERATION_IN_PROGRESS';
  constructor(message = 'Another mutating operation is currently running for this workflow.') {
    super(message);
    this.name = 'OperationInProgressError';
  }
}

export class WorkflowReconciliationError extends Error {
  readonly statusCode = 409;
  readonly code = 'WORKFLOW_RECONCILIATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowReconciliationError';
  }
}

