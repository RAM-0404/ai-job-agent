import { browserService, BrowserService } from './browser.service.js';
import { applicationDiscoveryService, ApplicationDiscoveryService } from './application-discovery.service.js';
import { autofillService, AutofillService } from './autofill.service.js';
import { browserNavigationService, BrowserNavigationService } from './browser-navigation.service.js';
import { workflowPersistenceService, WorkflowPersistenceService } from './workflow-persistence.service.js';
import { idempotencyService, IdempotencyService } from './idempotency.service.js';
import { workflowRecoveryService, WorkflowRecoveryService } from './workflow-recovery.service.js';
import {
  BrowserSessionNotFoundError,
  BrowserOperationError,
  NavigationControlNotFoundError,
  NavigationNotAllowedError,
  TerminalActionForbiddenError,
} from './browser.errors.js';
import type {
  MultiStepWorkflowState,
  MultiStepWorkflowStatus,
  StepAutofillRecord,
  StepProgressSummary,
  StepExecutionPayload,
  StepExecutionResponse,
  StepNavigationApprovalPayload,
  StepNavigationApprovalResponse,
  WorkflowHistoryResponse,
  WorkflowRecoveryResult,
  AutofillFieldProposalDto,
  AutofillFieldResultDto,
  AutofillValidationResultDto,
  NavigationControl,
  NavigationStep,
  DiscoveredFieldDto,
} from '@ai-job-agent/shared';

export class MultiStepWorkflowService {
  private readonly workflowStates = new Map<string, MultiStepWorkflowState>();

  constructor(
    private readonly browser: BrowserService = browserService,
    private readonly discovery: ApplicationDiscoveryService = applicationDiscoveryService,
    private readonly autofill: AutofillService = autofillService,
    private readonly navigation: BrowserNavigationService = browserNavigationService,
    private readonly persistence: WorkflowPersistenceService = workflowPersistenceService,
    private readonly idempotency: IdempotencyService = idempotencyService,
    private readonly recovery: WorkflowRecoveryService = workflowRecoveryService
  ) {}

  /**
   * Clears in-memory and persisted workflow state for a session.
   */
  async clearWorkflow(sessionId: string): Promise<void> {
    this.workflowStates.delete(sessionId);
    this.autofill.clearAutofill(sessionId);
    this.navigation.clearNavigation(sessionId);
    this.idempotency.releaseLock(sessionId);
    await this.persistence.deleteWorkflowState(sessionId);
  }

  /**
   * Retrieves active in-memory workflow state for a session synchronously.
   */
  getWorkflowState(sessionId: string): MultiStepWorkflowState {
    this.browser.getSession(sessionId); // Validates session exists
    const state = this.workflowStates.get(sessionId);
    if (!state) {
      throw new BrowserOperationError(`No active multi-step workflow initialized for session "${sessionId}". Initialize workflow first.`);
    }
    return state;
  }

  /**
   * Retrieves workflow state, checking in-memory first and hydrating from
   * durable persistence if needed (e.g. after API restart).
   */
  async getOrLoadWorkflowState(sessionId: string): Promise<MultiStepWorkflowState> {
    const cached = this.workflowStates.get(sessionId);
    if (cached) return cached;

    const persisted = await this.persistence.getPersistedWorkflowState(sessionId);
    if (persisted) {
      this.workflowStates.set(sessionId, persisted);
      return persisted;
    }

    this.browser.getSession(sessionId); // Will throw session not found if no session
    throw new BrowserOperationError(`No active multi-step workflow initialized for session "${sessionId}". Initialize workflow first.`);
  }

  /**
   * Retrieves full cumulative workflow history across all completed steps from memory.
   */
  getWorkflowHistory(sessionId: string): WorkflowHistoryResponse {
    const state = this.getWorkflowState(sessionId);
    return {
      sessionId,
      totalStepsCompleted: state.stepHistory.filter((s) => s.completed).length,
      stepHistory: state.stepHistory,
      currentState: state,
      applicationSubmitted: false,
    };
  }

  /**
   * Retrieves full cumulative workflow history across all completed steps,
   * hydrating from durable persistence if needed.
   */
  async getWorkflowHistoryAsync(sessionId: string): Promise<WorkflowHistoryResponse> {
    const state = await this.getOrLoadWorkflowState(sessionId);
    return {
      sessionId,
      totalStepsCompleted: state.stepHistory.filter((s) => s.completed).length,
      stepHistory: state.stepHistory,
      currentState: state,
      applicationSubmitted: false,
    };
  }

  /**
   * Discovers and initializes the multi-step workflow for the active browser session.
   * Discovers current step, maps fields, generates initial autofill proposals,
   * persists workflow state durably, and prepares the step for explicit human field approval.
   */
  async initWorkflow(
    sessionId: string,
    userProfileId?: string,
    idempotencyKey?: string
  ): Promise<MultiStepWorkflowState> {
    // 1. Idempotency and concurrency check
    const idempCheck = await this.idempotency.acquireOrCheckOperation<MultiStepWorkflowState>(
      sessionId,
      idempotencyKey,
      'INIT',
      { userProfileId }
    );
    if (idempCheck.cachedResult) {
      this.workflowStates.set(sessionId, idempCheck.cachedResult);
      return idempCheck.cachedResult;
    }

    try {
      // 2. Validate session exists
      this.browser.getSession(sessionId);

      // 3. Discover navigation controls and current step info
      const navState = await this.navigation.discoverNavigation(sessionId);
      const navStep = navState.currentStep;

      if (!navStep) {
        throw new BrowserOperationError(`Failed to detect step context for session "${sessionId}".`);
      }

      // 4. Discover fields on active DOM
      const rawDiscovery = await this.discovery.analyzePage(sessionId, undefined, userProfileId);
      const activeFieldIds = await this.getActiveStepFieldIdentifiers(sessionId);

      const stepFields = this.filterFieldsToActiveStep(rawDiscovery.fields, activeFieldIds);

      // 5. Generate autofill proposal from discovered fields scoped to active step
      const fullProposal = await this.autofill.createAutofillProposal(sessionId, rawDiscovery, userProfileId);
      const stepProposals = this.filterProposalsToActiveStep(fullProposal.proposals, activeFieldIds);

      // 6. Determine initial workflow status
      let status: MultiStepWorkflowStatus = 'STEP_READY';
      if (navStep.isTerminalDetected && navStep.controls.every((c) => c.isTerminal || !c.isExecutable)) {
        status = 'TERMINAL_REACHED';
      } else if (stepProposals.length > 0) {
        status = 'WAITING_FOR_FIELD_APPROVAL';
      }

      // 7. Calculate progress summary
      const requiredFieldCount = stepFields.filter((f) => f.required).length;
      const progress: StepProgressSummary = {
        currentStepIndex: navStep.stepIndex,
        stepHeading: navStep.heading,
        totalVisitedSteps: 1,
        currentStepFilledCount: 0,
        currentStepTotalFieldCount: stepFields.length,
        currentStepMissingRequiredCount: requiredFieldCount,
        terminalControlDetected: navStep.isTerminalDetected,
        isReadyForNavigation: false,
        isReviewStep: this.isReviewStep(navStep),
      };

      // 8. Initialize active step record
      const missingReqFields: string[] = stepFields
        .filter((f) => f.required)
        .map((f) => f.label || f.name || f.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

      const initialStepRecord: StepAutofillRecord = {
        stepId: navStep.stepId,
        stepIndex: navStep.stepIndex,
        stepHeading: navStep.heading,
        url: navStep.url,
        discoveredFieldCount: stepFields.length,
        discoveredFields: stepFields,
        proposals: stepProposals,
        approvedFieldIds: [],
        executionResults: [],
        validation: { valid: true, errors: [] },
        missingRequiredFields: missingReqFields,
        navigationControls: navStep.controls,
        selectedNavigationControlId: null,
        completed: false,
        visitedAt: new Date().toISOString(),
        completedAt: null,
      };

      const workflowState: MultiStepWorkflowState = {
        sessionId,
        status,
        version: 1,
        currentStepIndex: navStep.stepIndex,
        currentStepHeading: navStep.heading,
        currentStepId: navStep.stepId,
        currentUrl: navStep.url,
        discoveredFields: stepFields,
        currentProposals: stepProposals,
        lastExecutionResults: [],
        availableNavigationControls: navStep.controls,
        terminalControlDetected: navStep.isTerminalDetected,
        stepHistory: [initialStepRecord],
        progress,
        applicationSubmitted: false,
        lastUpdated: new Date().toISOString(),
      };

      // 9. Persist state durably and cache in memory
      await this.persistence.saveWorkflowState(workflowState, userProfileId);
      this.workflowStates.set(sessionId, workflowState);

      // 10. Record idempotency completion
      await this.idempotency.completeOperation(sessionId, idempotencyKey, workflowState);

      return workflowState;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.idempotency.failOperation(sessionId, idempotencyKey, 'FAILED', errorMsg);
      throw err;
    }
  }

  /**
   * Executes approved field-fill operations for the current active step.
   * Does NOT advance navigation. Navigation requires separate explicit human approval.
   */
  async executeStepFields(
    sessionId: string,
    payload: StepExecutionPayload,
    idempotencyKey?: string
  ): Promise<StepExecutionResponse> {
    const state = await this.getOrLoadWorkflowState(sessionId);

    if (!Array.isArray(payload.approvedFieldIds)) {
      throw new NavigationNotAllowedError('Payload must include an "approvedFieldIds" array.');
    }

    // 1. Idempotency check
    const idempCheck = await this.idempotency.acquireOrCheckOperation<StepExecutionResponse>(
      sessionId,
      idempotencyKey,
      'EXECUTE_FIELDS',
      payload
    );
    if (idempCheck.cachedResult) {
      return idempCheck.cachedResult;
    }

    try {
      state.status = 'FILLING_FIELDS';
      state.lastUpdated = new Date().toISOString();

      let fieldResults: AutofillFieldResultDto[] = [];
      let validationResult: AutofillValidationResultDto = { valid: true, errors: [] };

      if (payload.approvedFieldIds.length > 0) {
        // Populate approved fields via AutofillService
        const autofillResult = await this.autofill.approveAndAutofill(sessionId, payload.approvedFieldIds);
        fieldResults = autofillResult.results;
        validationResult = autofillResult.validation;
      } else {
        // All proposed fields were skipped by human decision
        fieldResults = state.currentProposals.map((prop) => ({
          fieldId: prop.fieldId,
          fieldName: prop.fieldName,
          fieldType: prop.fieldType,
          status: 'SKIPPED' as const,
          reason: 'Skipped by candidate decision (not included in approvedFieldIds).',
          verified: false,
        }));
        try {
          const reverify = await this.autofill.verifyAutofill(sessionId);
          validationResult = reverify.validation;
        } catch {
          validationResult = { valid: true, errors: [] };
        }
      }

      // 2. Identify missing required fields
      const filledSuccessIds = new Set(
        fieldResults.filter((r) => r.status === 'SUCCESS' && r.verified).map((r) => r.fieldId)
      );
      const missingRequired: string[] = state.discoveredFields
        .filter((f) => f.required && !filledSuccessIds.has(f.id || f.name || ''))
        .map((f) => f.label || f.name || f.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

      // 3. Update current step record in stepHistory
      const currentRecordIndex = state.stepHistory.findIndex((s) => s.stepId === state.currentStepId);
      if (currentRecordIndex >= 0) {
        state.stepHistory[currentRecordIndex].approvedFieldIds = payload.approvedFieldIds;
        state.stepHistory[currentRecordIndex].executionResults = fieldResults;
        state.stepHistory[currentRecordIndex].validation = validationResult;
        state.stepHistory[currentRecordIndex].missingRequiredFields = missingRequired;
      }

      // 4. Update workflow state status and progress
      const isTerminalOnly = state.availableNavigationControls.every((c) => c.isTerminal || !c.isExecutable);
      state.lastExecutionResults = fieldResults;
      state.status = isTerminalOnly
        ? 'TERMINAL_REACHED'
        : state.progress.isReviewStep
        ? 'REVIEW_REACHED'
        : 'WAITING_FOR_NAV_APPROVAL';

      state.progress.currentStepFilledCount = filledSuccessIds.size;
      state.progress.currentStepMissingRequiredCount = missingRequired.length;
      state.progress.isReadyForNavigation = true;
      state.lastUpdated = new Date().toISOString();

      const response: StepExecutionResponse = {
        success: true,
        stepIndex: state.currentStepIndex,
        stepHeading: state.currentStepHeading,
        results: fieldResults,
        validation: validationResult,
        missingRequiredFields: missingRequired,
        canNavigateForward: state.availableNavigationControls.some((c) => c.direction === 'FORWARD' && c.isExecutable),
        availableNavigationControls: state.availableNavigationControls,
        workflowState: state,
        applicationSubmitted: false,
      };

      // 5. Durably persist and complete idempotency record
      await this.persistence.saveWorkflowState(state, payload.userProfileId);
      await this.idempotency.completeOperation(sessionId, idempotencyKey, response);

      return response;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.idempotency.failOperation(sessionId, idempotencyKey, 'FAILED', errorMsg);
      throw err;
    }
  }

  /**
   * Explicitly approves and executes a forward or backward navigation control.
   * Terminal controls (Submit / Apply / Finish) are strictly rejected with HTTP 403 Forbidden.
   * Once navigation succeeds, automatically rediscovers the next step's fields and controls,
   * generating a new proposal where all fields start strictly unapproved (approved = false).
   */
  async approveStepNavigation(
    sessionId: string,
    controlId: string,
    userProfileId?: string,
    idempotencyKey?: string
  ): Promise<StepNavigationApprovalResponse> {
    const state = await this.getOrLoadWorkflowState(sessionId);

    // 1. Locate the control
    const control = state.availableNavigationControls.find((c) => c.id === controlId);
    if (!control) {
      throw new NavigationControlNotFoundError(controlId);
    }

    // SAFETY CHECK: Terminal controls are strictly forbidden from execution
    if (control.isTerminal || control.type === 'TERMINAL') {
      throw new TerminalActionForbiddenError(control.label);
    }

    if (!control.isExecutable) {
      throw new NavigationNotAllowedError(`Control "${control.label}" is not an executable navigation control.`);
    }

    // 2. Idempotency check
    const idempCheck = await this.idempotency.acquireOrCheckOperation<StepNavigationApprovalResponse>(
      sessionId,
      idempotencyKey,
      'NAVIGATE',
      { controlId, userProfileId }
    );
    if (idempCheck.cachedResult) {
      return idempCheck.cachedResult;
    }

    try {
      state.status = 'NAVIGATING';
      state.lastUpdated = new Date().toISOString();

      // 3. Mark current step record as completed
      const previousIndex = state.currentStepIndex;
      const currentRecord = state.stepHistory.find((s) => s.stepId === state.currentStepId);
      if (currentRecord) {
        currentRecord.completed = true;
        currentRecord.completedAt = new Date().toISOString();
        currentRecord.selectedNavigationControlId = controlId;
      }

      // 4. Execute navigation click via BrowserNavigationService
      const navResponse = await this.navigation.approveAndNavigate(sessionId, controlId);
      const nextStep = navResponse.currentStep;

      // 5. Discover new page fields via ApplicationDiscoveryService
      const rawDiscovery = await this.discovery.analyzePage(sessionId, undefined, userProfileId);
      const activeFieldIds = await this.getActiveStepFieldIdentifiers(sessionId);

      const stepFields = this.filterFieldsToActiveStep(rawDiscovery.fields, activeFieldIds);

      // 6. Generate fresh proposals for new step (every field starts unapproved)
      const fullProposal = await this.autofill.createAutofillProposal(sessionId, rawDiscovery, userProfileId);
      const stepProposals = this.filterProposalsToActiveStep(fullProposal.proposals, activeFieldIds);

      // 7. Create step record for newly discovered step
      const requiredCount = stepFields.filter((f) => f.required).length;
      const isTerminalDetected =
        nextStep.isTerminalDetected ||
        rawDiscovery.buttons.some(
          (b) =>
            b.classification === 'PRIMARY_APPLICATION_ACTION' &&
            (b.text.toLowerCase().includes('submit') || b.text.toLowerCase().includes('apply'))
        );

      const nextMissingReq: string[] = stepFields
        .filter((f) => f.required)
        .map((f) => f.label || f.name || f.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

      const nextStepRecord: StepAutofillRecord = {
        stepId: nextStep.stepId,
        stepIndex: nextStep.stepIndex,
        stepHeading: nextStep.heading,
        url: nextStep.url,
        discoveredFieldCount: stepFields.length,
        discoveredFields: stepFields,
        proposals: stepProposals,
        approvedFieldIds: [],
        executionResults: [],
        validation: { valid: true, errors: [] },
        missingRequiredFields: nextMissingReq,
        navigationControls: nextStep.controls,
        selectedNavigationControlId: null,
        completed: false,
        visitedAt: new Date().toISOString(),
        completedAt: null,
      };

      state.stepHistory.push(nextStepRecord);

      // 8. Update active workflow state
      const isTerminalOnly = nextStep.controls.every((c) => c.isTerminal || !c.isExecutable);
      const isReview = this.isReviewStep(nextStep);

      state.currentStepIndex = nextStep.stepIndex;
      state.currentStepHeading = nextStep.heading;
      state.currentStepId = nextStep.stepId;
      state.currentUrl = nextStep.url;
      state.discoveredFields = stepFields;
      state.currentProposals = stepProposals;
      state.lastExecutionResults = [];
      state.availableNavigationControls = nextStep.controls;
      state.terminalControlDetected = isTerminalDetected;

      state.status = isTerminalOnly
        ? 'TERMINAL_REACHED'
        : isReview
        ? 'REVIEW_REACHED'
        : stepProposals.length > 0
        ? 'WAITING_FOR_FIELD_APPROVAL'
        : 'STEP_READY';

      state.progress = {
        currentStepIndex: nextStep.stepIndex,
        stepHeading: nextStep.heading,
        totalVisitedSteps: state.stepHistory.length,
        currentStepFilledCount: 0,
        currentStepTotalFieldCount: stepFields.length,
        currentStepMissingRequiredCount: requiredCount,
        terminalControlDetected: isTerminalDetected,
        isReadyForNavigation: false,
        isReviewStep: isReview,
      };
      state.lastUpdated = new Date().toISOString();

      const response: StepNavigationApprovalResponse = {
        success: true,
        previousStepIndex: previousIndex,
        currentStepIndex: nextStep.stepIndex,
        newHeading: nextStep.heading,
        rediscoveredFieldCount: stepFields.length,
        newProposals: stepProposals,
        terminalControlDetected: isTerminalDetected,
        availableNavigationControls: nextStep.controls,
        workflowState: state,
        applicationSubmitted: false,
      };

      // 9. Persist state durably and complete idempotency record
      await this.persistence.saveWorkflowState(state, userProfileId);
      await this.idempotency.completeOperation(sessionId, idempotencyKey, response);

      return response;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.idempotency.failOperation(sessionId, idempotencyKey, 'FAILED', errorMsg);
      throw err;
    }
  }

  /**
   * Safe recovery operation for an interrupted or restarted workflow.
   */
  async recoverWorkflow(sessionId: string): Promise<WorkflowRecoveryResult> {
    const result = await this.recovery.recoverWorkflow(sessionId);
    if (result.success && result.workflowState) {
      this.workflowStates.set(sessionId, result.workflowState);
    }
    return result;
  }

  /**
   * Evaluates if a navigation step is a review / summary step.
   */
  private isReviewStep(step: NavigationStep): boolean {
    const text = `${step.heading || ''} ${step.title || ''}`.toLowerCase();
    return (
      text.includes('review') ||
      text.includes('summary') ||
      text.includes('confirmation') ||
      step.isTerminalDetected ||
      step.controls.some((c) => c.type === 'REVIEW' || c.isTerminal)
    );
  }

  /**
   * Retrieves element IDs / names that belong to the currently active multi-step container.
   */
  private async getActiveStepFieldIdentifiers(sessionId: string): Promise<string[]> {
    try {
      const ids = await this.browser.evaluateInSession<string[]>(sessionId, () => {
        const stepInputs = Array.from(
          document.querySelectorAll(
            '.step-section.active input, .step-section.active select, .step-section.active textarea, .wizard-step.active input, .wizard-step.active select, .wizard-step.active textarea'
          )
        );
        if (stepInputs.length > 0) {
          return stepInputs
            .map((el) => el.id || el.getAttribute('name') || '')
            .filter((val) => Boolean(val) && val.length > 0);
        }
        return [];
      });
      return ids || [];
    } catch {
      return [];
    }
  }

  /**
   * Filters discovered fields to those active in the current step.
   */
  private filterFieldsToActiveStep(
    fields: DiscoveredFieldDto[],
    activeIds: string[]
  ): DiscoveredFieldDto[] {
    if (activeIds.length === 0) return fields;
    const idSet = new Set(activeIds);
    const matched = fields.filter(
      (f) => (f.id && idSet.has(f.id)) || (f.name && idSet.has(f.name))
    );
    return matched.length > 0 ? matched : fields;
  }

  /**
   * Filters proposals to those belonging to the current step.
   */
  private filterProposalsToActiveStep(
    proposals: AutofillFieldProposalDto[],
    activeIds: string[]
  ): AutofillFieldProposalDto[] {
    if (activeIds.length === 0) return proposals;
    const idSet = new Set(activeIds);
    const matched = proposals.filter(
      (p) => (p.fieldId && idSet.has(p.fieldId)) || (p.fieldName && idSet.has(p.fieldName))
    );
    return matched.length > 0 ? matched : proposals;
  }
}

export const multiStepWorkflowService = new MultiStepWorkflowService();
