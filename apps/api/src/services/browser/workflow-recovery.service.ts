import { browserService, BrowserService } from './browser.service.js';
import { applicationDiscoveryService, ApplicationDiscoveryService } from './application-discovery.service.js';
import { browserNavigationService, BrowserNavigationService } from './browser-navigation.service.js';
import { workflowPersistenceService, WorkflowPersistenceService } from './workflow-persistence.service.js';
import { idempotencyService, IdempotencyService } from './idempotency.service.js';
import {
  BrowserSessionNotFoundError,
  WorkflowReconciliationError,
} from './browser.errors.js';
import type {
  MultiStepWorkflowState,
  MultiStepWorkflowStatus,
  WorkflowRecoveryResult,
  WorkflowRecoveryStatus,
  WorkflowRecoveryReason,
  WorkflowOperationRecord,
} from '@ai-job-agent/shared';

export class WorkflowRecoveryService {
  constructor(
    private readonly browser: BrowserService = browserService,
    private readonly navigation: BrowserNavigationService = browserNavigationService,
    private readonly discovery: ApplicationDiscoveryService = applicationDiscoveryService,
    private readonly persistence: WorkflowPersistenceService = workflowPersistenceService,
    private readonly idempotency: IdempotencyService = idempotencyService
  ) {}

  /**
   * Performs safe recovery and state reconciliation after an API restart or session interruption.
   * Evaluates the 6 explicit recovery cases:
   * 1. State persisted + browser session available + DOM matches snapshot -> RECOVERED / RECONCILED.
   * 2. State persisted + browser session lost -> REQUIRES_INTERVENTION (BROWSER_SESSION_LOST).
   * 3. Browser session available + DOM differs -> REQUIRES_REVIEW (DOM_MISMATCH).
   * 4. Operation interrupted before execution -> Rolled back to valid snapshot.
   * 5. Operation interrupted after potential browser side effect -> Reconciled or REQUIRES_REVIEW.
   * 6. State cannot be proven safe -> REQUIRES_INTERVENTION (UNRECONCILABLE).
   */
  async recoverWorkflow(sessionId: string): Promise<WorkflowRecoveryResult> {
    // 1. Retrieve last durably persisted workflow state
    const persistedState = await this.persistence.getPersistedWorkflowState(sessionId);
    if (!persistedState) {
      return {
        success: false,
        recoveryStatus: 'FAILED',
        reason: 'UNRECONCILABLE',
        message: `No persisted workflow state found for session "${sessionId}".`,
        browserSessionAvailable: false,
        domMatchesSnapshot: false,
        interruptedOperationDetected: false,
        actionRequired: 'Initialize a new workflow session.',
        canResume: false,
      };
    }

    // 2. Check if browser session is alive
    let browserSessionAlive = false;
    try {
      this.browser.getSession(sessionId);
      browserSessionAlive = true;
    } catch (err: unknown) {
      if (err instanceof BrowserSessionNotFoundError) {
        browserSessionAlive = false;
      } else {
        browserSessionAlive = false;
      }
    }

    // CASE 2: Browser session no longer exists (e.g. closed or lost on API restart)
    if (!browserSessionAlive) {
      persistedState.status = 'REQUIRES_INTERVENTION';
      persistedState.recoveryStatus = 'REQUIRES_INTERVENTION';
      persistedState.lastReconciledAt = new Date().toISOString();
      await this.persistence.saveWorkflowState(persistedState);

      return {
        success: false,
        recoveryStatus: 'REQUIRES_INTERVENTION',
        reason: 'BROWSER_SESSION_LOST',
        message: `Browser session "${sessionId}" no longer exists in browser engine. A new browser session is required; stale references cannot be resumed.`,
        browserSessionAvailable: false,
        domMatchesSnapshot: false,
        interruptedOperationDetected: false,
        actionRequired: 'Launch a new browser session and re-initialize workflow.',
        workflowState: persistedState,
        canResume: false,
      };
    }

    // 3. Inspect active DOM and discover current page state
    let observedUrl = '';
    let observedHeading: string | null = null;
    let observedStepIndex = 1;

    try {
      const pageInfo = await this.browser.inspectPage(sessionId);
      observedUrl = pageInfo.url;

      const navState = await this.navigation.discoverNavigation(sessionId);
      if (navState.currentStep) {
        observedHeading = navState.currentStep.heading;
        observedStepIndex = navState.currentStep.stepIndex;
      }
    } catch (err: unknown) {
      persistedState.status = 'REQUIRES_REVIEW';
      persistedState.recoveryStatus = 'REQUIRES_REVIEW';
      persistedState.lastReconciledAt = new Date().toISOString();
      await this.persistence.saveWorkflowState(persistedState);

      return {
        success: false,
        recoveryStatus: 'REQUIRES_REVIEW',
        reason: 'UNRECONCILABLE',
        message: `Failed to inspect active browser page for session "${sessionId}": ${err instanceof Error ? err.message : String(err)}`,
        browserSessionAvailable: true,
        domMatchesSnapshot: false,
        interruptedOperationDetected: false,
        actionRequired: 'Check browser connectivity and refresh page state.',
        workflowState: persistedState,
        canResume: false,
      };
    }

    // CASE 3: Browser DOM differs from persisted snapshot
    const urlMatches = this.normalizeUrl(observedUrl) === this.normalizeUrl(persistedState.currentUrl);
    const stepMatches = observedStepIndex === persistedState.currentStepIndex;
    const headingMatches =
      !persistedState.currentStepHeading ||
      !observedHeading ||
      observedHeading.toLowerCase().trim() === persistedState.currentStepHeading.toLowerCase().trim();

    if (!urlMatches || !stepMatches || !headingMatches) {
      persistedState.status = 'REQUIRES_REVIEW';
      persistedState.recoveryStatus = 'REQUIRES_REVIEW';
      persistedState.lastReconciledAt = new Date().toISOString();
      await this.persistence.saveWorkflowState(persistedState);

      return {
        success: false,
        recoveryStatus: 'REQUIRES_REVIEW',
        reason: 'DOM_MISMATCH',
        message: `Active page DOM differs from persisted checkpoint. Expected Step ${persistedState.currentStepIndex} ("${persistedState.currentStepHeading}") at ${persistedState.currentUrl}, but found Step ${observedStepIndex} ("${observedHeading}") at ${observedUrl}.`,
        browserSessionAvailable: true,
        domMatchesSnapshot: false,
        interruptedOperationDetected: false,
        actionRequired: 'Manual human review required to resolve page disparity before resuming.',
        workflowState: persistedState,
        canResume: false,
      };
    }

    // 4. Check for interrupted operations
    const operations = await this.persistence.listOperationsForSession(sessionId);
    const interruptedOp = operations.find((op) => op.status === 'RUNNING');

    if (interruptedOp) {
      // Mark interrupted operation as REQUIRES_REVIEW or UNKNOWN
      await this.persistence.updateOperationStatus(
        sessionId,
        interruptedOp.idempotencyKey,
        'REQUIRES_REVIEW',
        undefined,
        'Operation interrupted by process interruption or crash.'
      );
      this.idempotency.releaseLock(sessionId);

      persistedState.status = 'REQUIRES_REVIEW';
      persistedState.recoveryStatus = 'REQUIRES_REVIEW';
      persistedState.lastReconciledAt = new Date().toISOString();
      await this.persistence.saveWorkflowState(persistedState);

      return {
        success: false,
        recoveryStatus: 'REQUIRES_REVIEW',
        reason: 'OPERATION_INTERRUPTED_POST',
        message: `An in-flight operation (${interruptedOp.operationType}, key: "${interruptedOp.idempotencyKey}") was interrupted before persistence completed. Browser side effects may have occurred.`,
        browserSessionAvailable: true,
        domMatchesSnapshot: true,
        interruptedOperationDetected: true,
        interruptedOperationKey: interruptedOp.idempotencyKey,
        actionRequired: 'Verify form field values on the current page before re-executing.',
        workflowState: persistedState,
        canResume: false,
      };
    }

    const unresolvedOp = operations.find((op) => op.status === 'REQUIRES_REVIEW' || op.status === 'UNKNOWN');
    if (unresolvedOp) {
      return {
        success: false,
        recoveryStatus: 'REQUIRES_REVIEW',
        reason: 'OPERATION_INTERRUPTED_POST',
        message: `An operation (${unresolvedOp.operationType}, key: "${unresolvedOp.idempotencyKey}") previously required manual review and has not yet been resolved.`,
        browserSessionAvailable: true,
        domMatchesSnapshot: true,
        interruptedOperationDetected: true,
        interruptedOperationKey: unresolvedOp.idempotencyKey,
        actionRequired: 'Verify form field values on the current page before re-executing.',
        workflowState: persistedState,
        canResume: false,
      };
    }

    // CASE 1: Successful reconciliation
    persistedState.recoveryStatus = 'RECOVERED';
    persistedState.lastReconciledAt = new Date().toISOString();
    await this.persistence.saveWorkflowState(persistedState);

    return {
      success: true,
      recoveryStatus: 'RECOVERED',
      reason: 'RECONCILED',
      message: `Workflow state successfully reconciled with live browser session at Step ${persistedState.currentStepIndex} ("${persistedState.currentStepHeading}").`,
      browserSessionAvailable: true,
      domMatchesSnapshot: true,
      interruptedOperationDetected: false,
      workflowState: persistedState,
      canResume: true,
    };
  }

  private normalizeUrl(rawUrl: string): string {
    try {
      const u = new URL(rawUrl);
      return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
    } catch {
      return (rawUrl || '').replace(/\/+$/, '');
    }
  }
}

export const workflowRecoveryService = new WorkflowRecoveryService();
