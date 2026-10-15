/**
 * Multi-Step Workflow Orchestration Types (Milestone 12.2).
 * Strictly coordinates per-step autofill proposals, explicit human field approval,
 * observational DOM verification, and separate explicit navigation approval.
 * Terminal controls (Submit / Apply) remain strictly non-executable.
 */

import type { DiscoveredFieldDto } from './application-discovery.js';
import type {
  AutofillFieldProposalDto,
  AutofillFieldResultDto,
  AutofillValidationResultDto,
} from './autofill.js';
import type { NavigationControl } from './browser-navigation.js';

export type MultiStepWorkflowStatus =
  | 'INITIALIZING'
  | 'STEP_READY'
  | 'WAITING_FOR_FIELD_APPROVAL'
  | 'FILLING_FIELDS'
  | 'STEP_COMPLETED'
  | 'WAITING_FOR_NAV_APPROVAL'
  | 'NAVIGATING'
  | 'REVIEW_REACHED'
  | 'TERMINAL_REACHED'
  | 'RECOVERING'
  | 'REQUIRES_REVIEW'
  | 'REQUIRES_INTERVENTION'
  | 'FAILED';

export type WorkflowOperationStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'UNKNOWN'
  | 'REQUIRES_REVIEW';

export type WorkflowOperationType =
  | 'INIT'
  | 'EXECUTE_FIELDS'
  | 'NAVIGATE'
  | 'RECOVER'
  | 'CLEAR';

export type WorkflowRecoveryReason =
  | 'HEALTHY'
  | 'RECONCILED'
  | 'BROWSER_SESSION_LOST'
  | 'DOM_MISMATCH'
  | 'OPERATION_INTERRUPTED_PRE'
  | 'OPERATION_INTERRUPTED_POST'
  | 'UNRECONCILABLE';

export type WorkflowRecoveryStatus =
  | 'RECOVERED'
  | 'REQUIRES_REVIEW'
  | 'REQUIRES_INTERVENTION'
  | 'FAILED';

export interface WorkflowOperationRecord {
  id: string;
  sessionId: string;
  idempotencyKey: string;
  operationType: WorkflowOperationType;
  requestPayloadHash: string;
  status: WorkflowOperationStatus;
  responsePayload?: any;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface WorkflowRecoveryResult {
  success: boolean;
  recoveryStatus: WorkflowRecoveryStatus;
  reason: WorkflowRecoveryReason;
  message: string;
  browserSessionAvailable: boolean;
  domMatchesSnapshot: boolean;
  interruptedOperationDetected: boolean;
  interruptedOperationKey?: string;
  actionRequired?: string;
  workflowState?: MultiStepWorkflowState;
  canResume: boolean;
}

export interface StepAutofillRecord {
  /** Stable step identifier */
  stepId: string;
  /** 1-based step index */
  stepIndex: number;
  /** Primary heading or title of this step */
  stepHeading: string | null;
  /** Page URL at this step */
  url: string;
  /** Total interactive fields discovered at this step */
  discoveredFieldCount: number;
  /** Discovered field definitions */
  discoveredFields: DiscoveredFieldDto[];
  /** Proposed autofill mappings */
  proposals: AutofillFieldProposalDto[];
  /** Explicitly approved field IDs for this step */
  approvedFieldIds: string[];
  /** Execution and DOM verification results */
  executionResults: AutofillFieldResultDto[];
  /** Observational validation status */
  validation: AutofillValidationResultDto;
  /** Required fields that remained unmapped or unpopulated */
  missingRequiredFields: string[];
  /** Detected navigation controls on this step */
  navigationControls: NavigationControl[];
  /** Control used to navigate past this step, if completed */
  selectedNavigationControlId: string | null;
  /** Whether this step has been completed and navigated past */
  completed: boolean;
  /** ISO timestamp when this step was first visited */
  visitedAt: string;
  /** ISO timestamp when this step was executed / completed */
  completedAt: string | null;
}

export interface StepProgressSummary {
  /** Current 1-based step index */
  currentStepIndex: number;
  /** Current step heading */
  stepHeading: string | null;
  /** Total visited steps recorded so far */
  totalVisitedSteps: number;
  /** Number of fields verified populated on current step */
  currentStepFilledCount: number;
  /** Total fields detected on current step */
  currentStepTotalFieldCount: number;
  /** Required fields still missing or unfilled on current step */
  currentStepMissingRequiredCount: number;
  /** Whether a terminal control (Submit / Apply) is present */
  terminalControlDetected: boolean;
  /** Whether current step fields have been populated and step is ready for navigation approval */
  isReadyForNavigation: boolean;
  /** Whether the current step is a review step */
  isReviewStep: boolean;
}

export interface StepExecutionPayload {
  /** Array of field IDs explicitly approved by the human operator */
  approvedFieldIds: string[];
  /** Optional profile ID to load candidate data from */
  userProfileId?: string;
}

export interface StepExecutionResponse {
  success: boolean;
  stepIndex: number;
  stepHeading: string | null;
  results: AutofillFieldResultDto[];
  validation: AutofillValidationResultDto;
  missingRequiredFields: string[];
  canNavigateForward: boolean;
  availableNavigationControls: NavigationControl[];
  workflowState: MultiStepWorkflowState;
  applicationSubmitted: false;
}

export interface StepNavigationApprovalPayload {
  /** Deterministic ID of the navigation control to execute */
  controlId: string;
}

export interface StepNavigationApprovalResponse {
  success: boolean;
  previousStepIndex: number;
  currentStepIndex: number;
  newHeading: string | null;
  rediscoveredFieldCount: number;
  newProposals: AutofillFieldProposalDto[];
  terminalControlDetected: boolean;
  availableNavigationControls: NavigationControl[];
  workflowState: MultiStepWorkflowState;
  applicationSubmitted: false;
}

export interface MultiStepWorkflowState {
  sessionId: string;
  status: MultiStepWorkflowStatus;
  version?: number;
  currentStepIndex: number;
  currentStepHeading: string | null;
  currentStepId: string;
  currentUrl: string;
  discoveredFields: DiscoveredFieldDto[];
  currentProposals: AutofillFieldProposalDto[];
  lastExecutionResults: AutofillFieldResultDto[];
  availableNavigationControls: NavigationControl[];
  terminalControlDetected: boolean;
  stepHistory: StepAutofillRecord[];
  progress: StepProgressSummary;
  recoveryStatus?: WorkflowRecoveryStatus;
  lastReconciledAt?: string;
  /** Strictly false: Milestone 12.2/12.3 NEVER submits any application */
  applicationSubmitted: false;
  lastUpdated: string;
}

export interface WorkflowHistoryResponse {
  sessionId: string;
  totalStepsCompleted: number;
  stepHistory: StepAutofillRecord[];
  currentState: MultiStepWorkflowState;
  applicationSubmitted: false;
}
