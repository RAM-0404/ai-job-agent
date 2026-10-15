import { apiClient } from './client.js';
import type {
  CreateBrowserSessionResponse,
  BrowserSessionDto,
  BrowserPageInspectionDto,
  BrowserScreenshotDto,
  CloseBrowserSessionResponse,
  ApplicationPageAnalysisDto,
  DiscoverApplicationPageRequest,
  AutofillProposalDto,
  AutofillResultDto,
  NavigationState,
  ApproveNavigationResponse,
  MultiStepWorkflowState,
  StepExecutionPayload,
  StepExecutionResponse,
  StepNavigationApprovalResponse,
  WorkflowHistoryResponse,
  WorkflowRecoveryResult,
  WorkflowOperationRecord,
} from '@ai-job-agent/shared';

/**
 * Creates an isolated browser session.
 */
export async function createBrowserSession(): Promise<CreateBrowserSessionResponse> {
  return apiClient<CreateBrowserSessionResponse>('/browser/sessions', {
    method: 'POST',
  });
}

/**
 * Retrieves the current metadata and state of an existing browser session.
 */
export async function getBrowserSession(sessionId: string): Promise<BrowserSessionDto> {
  return apiClient<BrowserSessionDto>(`/browser/sessions/${sessionId}`, {
    method: 'GET',
  });
}

/**
 * Navigates to a target URL (if provided) and performs read-only structural application discovery.
 * Strictly observational: does NOT fill forms or click buttons.
 */
export async function discoverApplicationPage(
  sessionId: string,
  data?: DiscoverApplicationPageRequest
): Promise<ApplicationPageAnalysisDto> {
  return apiClient<ApplicationPageAnalysisDto>(
    `/browser/sessions/${sessionId}/application-discovery`,
    {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }
  );
}

/**
 * Performs diagnostic structural inspection of the current session page.
 */
export async function inspectBrowserPage(
  sessionId: string
): Promise<BrowserPageInspectionDto> {
  return apiClient<BrowserPageInspectionDto>(
    `/browser/sessions/${sessionId}/inspect`,
    {
      method: 'GET',
    }
  );
}

/**
 * Captures a screenshot of the active session page to controlled storage.
 */
export async function captureBrowserScreenshot(
  sessionId: string
): Promise<BrowserScreenshotDto> {
  return apiClient<BrowserScreenshotDto>(
    `/browser/sessions/${sessionId}/screenshot`,
    {
      method: 'POST',
    }
  );
}

/**
 * Closes the browser session and releases associated memory/browser context.
 */
export async function closeBrowserSession(
  sessionId: string
): Promise<CloseBrowserSessionResponse> {
  return apiClient<CloseBrowserSessionResponse>(
    `/browser/sessions/${sessionId}`,
    {
      method: 'DELETE',
    }
  );
}

/**
 * Creates an autofill proposal based on discovered form elements and candidate data.
 * All fields start in an unapproved state (`approved = false`).
 */
export async function createAutofillProposal(
  sessionId: string,
  userProfileId?: string
): Promise<AutofillProposalDto> {
  return apiClient<AutofillProposalDto>(
    `/browser/sessions/${sessionId}/autofill/proposal`,
    {
      method: 'POST',
      body: userProfileId ? JSON.stringify({ userProfileId }) : undefined,
    }
  );
}

/**
 * Retrieves the current autofill proposal for an active session.
 */
export async function getAutofillProposal(
  sessionId: string
): Promise<AutofillProposalDto> {
  return apiClient<AutofillProposalDto>(
    `/browser/sessions/${sessionId}/autofill/proposal`,
    {
      method: 'GET',
    }
  );
}

/**
 * Explicitly approves selected field IDs and executes controlled browser form population.
 * Only the explicitly approved field IDs are filled. Form submission is NEVER performed.
 */
export async function approveAutofill(
  sessionId: string,
  fieldIds: string[]
): Promise<AutofillResultDto> {
  return apiClient<AutofillResultDto>(
    `/browser/sessions/${sessionId}/autofill/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ fieldIds }),
    }
  );
}

/**
 * Verifies populated field values and detects validation errors on the page.
 */
export async function verifyAutofill(
  sessionId: string
): Promise<AutofillResultDto> {
  return apiClient<AutofillResultDto>(
    `/browser/sessions/${sessionId}/autofill/verify`,
    {
      method: 'POST',
    }
  );
}

/**
 * Clears in-memory autofill state for a browser session.
 */
export async function clearAutofill(
  sessionId: string
): Promise<{ success: boolean; sessionId: string }> {
  return apiClient<{ success: boolean; sessionId: string }>(
    `/browser/sessions/${sessionId}/autofill`,
    {
      method: 'DELETE',
    }
  );
}

/**
 * Discovers current step and navigation controls (M12.1).
 */
export async function discoverNavigation(
  sessionId: string,
  targetUrl?: string
): Promise<NavigationState> {
  return apiClient<NavigationState>(
    `/browser/sessions/${sessionId}/navigation/discover`,
    {
      method: 'POST',
      body: targetUrl ? JSON.stringify({ targetUrl }) : undefined,
    }
  );
}

/**
 * Retrieves current navigation state for an active session.
 */
export async function getNavigationState(
  sessionId: string
): Promise<NavigationState> {
  return apiClient<NavigationState>(
    `/browser/sessions/${sessionId}/navigation`,
    {
      method: 'GET',
    }
  );
}

/**
 * Explicitly approves a non-terminal navigation control and executes step transition.
 * Terminal submission controls are rejected with 403 Forbidden.
 */
export async function approveNavigation(
  sessionId: string,
  controlId: string
): Promise<ApproveNavigationResponse> {
  return apiClient<ApproveNavigationResponse>(
    `/browser/sessions/${sessionId}/navigation/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ controlId }),
    }
  );
}

/**
 * Clears in-memory navigation state for a session.
 */
export async function clearNavigation(
  sessionId: string
): Promise<{ success: boolean; sessionId: string }> {
  return apiClient<{ success: boolean; sessionId: string }>(
    `/browser/sessions/${sessionId}/navigation`,
    {
      method: 'DELETE',
    }
  );
}

/**
 * Initializes and discovers the multi-step workflow for the active session (M12.2).
 */
export async function initMultiStepWorkflow(
  sessionId: string,
  userProfileId?: string,
  idempotencyKey?: string
): Promise<MultiStepWorkflowState> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) {
    headers['x-idempotency-key'] = idempotencyKey;
  }
  return apiClient<MultiStepWorkflowState>(
    `/browser/sessions/${sessionId}/workflow/init`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ userProfileId }),
    }
  );
}

/**
 * Retrieves the current multi-step workflow state.
 */
export async function getMultiStepWorkflowState(
  sessionId: string
): Promise<MultiStepWorkflowState> {
  return apiClient<MultiStepWorkflowState>(
    `/browser/sessions/${sessionId}/workflow/state`,
    {
      method: 'GET',
    }
  );
}

/**
 * Executes approved field-fill operations for the current active step.
 */
export async function executeWorkflowStepFields(
  sessionId: string,
  data: StepExecutionPayload,
  idempotencyKey?: string
): Promise<StepExecutionResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) {
    headers['x-idempotency-key'] = idempotencyKey;
  }
  return apiClient<StepExecutionResponse>(
    `/browser/sessions/${sessionId}/workflow/step/execute`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    }
  );
}

/**
 * Explicitly approves a navigation control and advances to the next step.
 */
export async function approveWorkflowStepNavigation(
  sessionId: string,
  controlId: string,
  userProfileId?: string,
  idempotencyKey?: string
): Promise<StepNavigationApprovalResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) {
    headers['x-idempotency-key'] = idempotencyKey;
  }
  return apiClient<StepNavigationApprovalResponse>(
    `/browser/sessions/${sessionId}/workflow/step/navigate`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ controlId, userProfileId }),
    }
  );
}

/**
 * Safe recovery operation after API restart or browser disruption.
 */
export async function recoverWorkflow(
  sessionId: string
): Promise<WorkflowRecoveryResult> {
  return apiClient<WorkflowRecoveryResult>(
    `/browser/sessions/${sessionId}/workflow/recover`,
    {
      method: 'POST',
    }
  );
}

/**
 * Retrieves operation history for a session.
 */
export async function getWorkflowOperations(
  sessionId: string
): Promise<{ sessionId: string; operations: WorkflowOperationRecord[] }> {
  return apiClient<{ sessionId: string; operations: WorkflowOperationRecord[] }>(
    `/browser/sessions/${sessionId}/workflow/operations`,
    {
      method: 'GET',
    }
  );
}

/**
 * Retrieves cumulative workflow step history across all completed steps.
 */
export async function getWorkflowHistory(
  sessionId: string
): Promise<WorkflowHistoryResponse> {
  return apiClient<WorkflowHistoryResponse>(
    `/browser/sessions/${sessionId}/workflow/history`,
    {
      method: 'GET',
    }
  );
}

/**
 * Clears in-memory and persisted workflow state for a session.
 */
export async function clearWorkflow(
  sessionId: string
): Promise<{ success: boolean; sessionId: string }> {
  return apiClient<{ success: boolean; sessionId: string }>(
    `/browser/sessions/${sessionId}/workflow`,
    {
      method: 'DELETE',
    }
  );
}
