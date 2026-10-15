/**
 * Strongly typed browser multi-step navigation types (Milestone 12.1).
 * Strictly observational and human-approved: NO automatic submission,
 * terminal controls are never executable.
 */

export type NavigationControlType =
  | 'NEXT'
  | 'PREVIOUS'
  | 'CONTINUE'
  | 'BACK'
  | 'REVIEW'
  | 'TERMINAL'
  | 'UNKNOWN';

export type NavigationDirection =
  | 'FORWARD'
  | 'BACKWARD'
  | 'REVIEW'
  | 'TERMINAL'
  | 'UNKNOWN';

export type NavigationStatus =
  | 'IDLE'
  | 'STEP_DETECTED'
  | 'WAITING_FOR_APPROVAL'
  | 'NAVIGATING'
  | 'COMPLETED'
  | 'TERMINAL_REACHED'
  | 'FAILED';

export interface NavigationControl {
  /** Deterministic identifier for this control in the current step */
  id: string;
  /** Semantic classification */
  type: NavigationControlType;
  /** Raw textual label from the DOM */
  label: string;
  /** Lowercased, whitespace-trimmed label */
  normalizedLabel: string;
  /** Direction of navigation */
  direction: NavigationDirection;
  /** True ONLY for safe non-terminal navigation controls (Next, Continue, Back, Previous, Review) */
  isExecutable: boolean;
  /** True for terminal controls (Submit, Apply, Finish). Terminal controls are NEVER executable. */
  isTerminal: boolean;
  /** HTML tag name */
  tag: 'button' | 'a' | 'input';
  /** Button type attribute if applicable */
  buttonType?: string;
  /** Safe selector targeting this control */
  selector: string;
  /** Disabled attribute state */
  disabled: boolean;
  /** Index of enclosing form if any */
  formIndex: number | null;
}

export interface NavigationStep {
  /** Stable step identifier */
  stepId: string;
  /** 1-based step index */
  stepIndex: number;
  /** Step URL */
  url: string;
  /** Page title at this step */
  title: string;
  /** Prominent heading or step name if detected */
  heading: string | null;
  /** Total interactive fields discovered at this step */
  discoveredFieldCount: number;
  /** Required fields discovered at this step */
  requiredFieldCount: number;
  /** Navigation controls detected on this step */
  controls: NavigationControl[];
  /** Whether a terminal control (Submit / Apply) was detected on this step */
  isTerminalDetected: boolean;
  /** Whether observational validation errors are present on this step */
  hasValidationErrors: boolean;
  /** ISO timestamp when this step was first visited */
  visitedAt: string;
  /** Whether navigation past this step has completed */
  completed: boolean;
}

export interface StepTransitionRecord {
  fromStepId: string | null;
  toStepId: string;
  controlId: string;
  controlType: NavigationControlType;
  controlLabel: string;
  timestamp: string;
}

export interface NavigationState {
  sessionId: string;
  status: NavigationStatus;
  currentStep: NavigationStep | null;
  visitedSteps: NavigationStep[];
  stepHistory: StepTransitionRecord[];
  currentUrl: string | null;
  currentTitle: string | null;
  detectedControls: NavigationControl[];
  terminalControlDetected: boolean;
  hasValidationErrors: boolean;
  lastDiscoveryTimestamp: string | null;
}

export interface DiscoverNavigationRequest {
  targetUrl?: string;
}

export interface ApproveNavigationRequest {
  controlId: string;
}

export interface NavigationValidationStatusDto {
  hasErrors: boolean;
  errorCount: number;
  messages: string[];
}

export interface ApproveNavigationResponse {
  success: boolean;
  previousStep: NavigationStep | null;
  currentStep: NavigationStep;
  controlUsed: NavigationControl;
  newUrl: string;
  newTitle: string;
  rediscoveredFieldCount: number;
  rediscoveredControls: NavigationControl[];
  terminalControlDetected: boolean;
  validationStatus: NavigationValidationStatusDto;
  navigationState: NavigationState;
}
