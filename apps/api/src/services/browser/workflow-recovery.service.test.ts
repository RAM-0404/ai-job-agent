import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { workflowPersistenceService } from './workflow-persistence.service.js';
import { idempotencyService } from './idempotency.service.js';
import { workflowRecoveryService } from './workflow-recovery.service.js';
import { multiStepWorkflowService } from './multi-step-workflow.service.js';
import { browserService } from './browser.service.js';
import {
  IdempotencyConflictError,
  OperationInProgressError,
  TerminalActionForbiddenError,
} from './browser.errors.js';
import type {
  MultiStepWorkflowState,
  StepAutofillRecord,
} from '@ai-job-agent/shared';

describe('Milestone 12.3: Workflow Recovery & Idempotency Services', () => {
  const testSessionId = 'm12-3-test-session-' + Date.now();

  const dummyState: MultiStepWorkflowState = {
    sessionId: testSessionId,
    status: 'STEP_READY',
    version: 1,
    currentStepIndex: 1,
    currentStepHeading: 'Step 1: Contact Information',
    currentStepId: 'step-1',
    currentUrl: 'http://127.0.0.1:3000/browser/test-page/multi-step',
    discoveredFields: [
      {
        index: 0,
        formIndex: 0,
        tag: 'input',
        type: 'TEXT',
        name: 'fullName',
        id: 'fullName',
        placeholder: null,
        autocomplete: null,
        ariaLabel: null,
        required: true,
        requirementSource: 'required',
        disabled: false,
        readOnly: false,
        hasValue: false,
        label: 'Full Name',
        labelSource: 'label',
        helpText: null,
      },
      {
        index: 1,
        formIndex: 0,
        tag: 'input',
        type: 'PASSWORD',
        name: 'password',
        id: 'password',
        placeholder: null,
        autocomplete: null,
        ariaLabel: null,
        required: true,
        requirementSource: 'required',
        disabled: false,
        readOnly: false,
        hasValue: true,
        label: 'Password',
        labelSource: 'label',
        helpText: null,
      },
    ],
    currentProposals: [
      {
        fieldId: 'fullName',
        fieldName: 'fullName',
        fieldType: 'TEXT',
        tag: 'input',
        label: 'Full Name',
        candidateSource: 'PROFILE',
        proposedValue: 'Jane Doe',
        displayValue: 'Jane Doe',
        confidence: 0.95,
        reason: 'Matched candidate name',
        approved: false,
      },
      {
        fieldId: 'password',
        fieldName: 'password',
        fieldType: 'PASSWORD',
        tag: 'input',
        label: 'Password',
        candidateSource: 'PROFILE',
        proposedValue: 'secret123',
        displayValue: '••••••••',
        confidence: 0.95,
        reason: 'Sensitive password',
        approved: true,
      },
    ],
    lastExecutionResults: [],
    availableNavigationControls: [
      {
        id: 'ctrl-next',
        type: 'NEXT',
        label: 'Next Step',
        normalizedLabel: 'next step',
        direction: 'FORWARD',
        isTerminal: false,
        isExecutable: true,
        tag: 'button',
        selector: '#next',
        disabled: false,
        formIndex: 0,
      },
      {
        id: 'ctrl-submit',
        type: 'TERMINAL',
        label: 'Submit Application',
        normalizedLabel: 'submit application',
        direction: 'FORWARD',
        isTerminal: true,
        isExecutable: false,
        tag: 'button',
        selector: '#submit',
        disabled: false,
        formIndex: 0,
      },
    ],
    terminalControlDetected: true,
    stepHistory: [],
    progress: {
      currentStepIndex: 1,
      stepHeading: 'Step 1: Contact Information',
      totalVisitedSteps: 1,
      currentStepFilledCount: 0,
      currentStepTotalFieldCount: 2,
      currentStepMissingRequiredCount: 2,
      terminalControlDetected: true,
      isReadyForNavigation: false,
      isReviewStep: false,
    },
    applicationSubmitted: false,
    lastUpdated: new Date().toISOString(),
  };

  after(async () => {
    await workflowPersistenceService.deleteWorkflowState(testSessionId);
    idempotencyService.releaseLock(testSessionId);
  });

  describe('1. Durable Workflow Persistence & Sanitization', () => {
    it('sanitizes password and unknown fields before saving', async () => {
      const sanitized = workflowPersistenceService.sanitizeWorkflowState(dummyState);
      const passwordProp = sanitized.currentProposals.find((p) => p.fieldType === 'PASSWORD');
      assert.equal(passwordProp?.proposedValue, '');
      assert.equal(passwordProp?.approved, false);
      const passwordField = sanitized.discoveredFields.find((f) => f.type === 'PASSWORD');
      assert.equal(passwordField?.hasValue, false);
    });

    it('saves and retrieves workflow state with version increment', async () => {
      const saved = await workflowPersistenceService.saveWorkflowState(dummyState);
      assert.equal(saved.version, 2);

      const retrieved = await workflowPersistenceService.getPersistedWorkflowState(testSessionId);
      assert.ok(retrieved);
      assert.equal(retrieved.sessionId, testSessionId);
      assert.equal(retrieved.version, 2);
      assert.equal(retrieved.currentStepIndex, 1);
    });
  });

  describe('2. Idempotency & Concurrency Control', () => {
    const idempKey = 'key-test-123';
    const payload = { approvedFieldIds: ['fullName'] };

    it('acquires lock for new operation', async () => {
      const result = await idempotencyService.acquireOrCheckOperation(
        testSessionId,
        idempKey,
        'EXECUTE_FIELDS',
        payload
      );
      assert.equal(result.lockAcquired, true);
      assert.equal(result.cachedResult, undefined);
    });

    it('rejects concurrent operation on same session while running', async () => {
      await assert.rejects(
        async () => {
          await idempotencyService.acquireOrCheckOperation(
            testSessionId,
            'key-test-456',
            'EXECUTE_FIELDS',
            payload
          );
        },
        (err: unknown) => err instanceof OperationInProgressError
      );
    });

    it('completes operation and caches response', async () => {
      const responsePayload = { success: true, verified: 1 };
      await idempotencyService.completeOperation(testSessionId, idempKey, responsePayload);

      // Re-requesting with same key returns cached result
      const duplicate = await idempotencyService.acquireOrCheckOperation(
        testSessionId,
        idempKey,
        'EXECUTE_FIELDS',
        payload
      );
      assert.equal(duplicate.lockAcquired, false);
      assert.deepEqual(duplicate.cachedResult, responsePayload);
    });

    it('rejects reused key with different request payload with 409 conflict', async () => {
      const differentPayload = { approvedFieldIds: ['fullName', 'email'] };
      await assert.rejects(
        async () => {
          await idempotencyService.acquireOrCheckOperation(
            testSessionId,
            idempKey,
            'EXECUTE_FIELDS',
            differentPayload
          );
        },
        (err: unknown) => err instanceof IdempotencyConflictError
      );
    });
  });

  describe('3. Workflow Recovery Service', () => {
    it('Case 2: detects lost browser session (e.g. after API restart)', async () => {
      // testSessionId does not have an active Playwright browser session
      const recovery = await workflowRecoveryService.recoverWorkflow(testSessionId);
      assert.equal(recovery.success, false);
      assert.equal(recovery.recoveryStatus, 'REQUIRES_INTERVENTION');
      assert.equal(recovery.reason, 'BROWSER_SESSION_LOST');
      assert.equal(recovery.browserSessionAvailable, false);
      assert.equal(recovery.canResume, false);
      assert.ok(recovery.actionRequired);
    });

    it('Case 6: handles unknown session with no persisted state', async () => {
      const unknownSessionId = 'non-existent-' + Date.now();
      const recovery = await workflowRecoveryService.recoverWorkflow(unknownSessionId);
      assert.equal(recovery.success, false);
      assert.equal(recovery.recoveryStatus, 'FAILED');
      assert.equal(recovery.reason, 'UNRECONCILABLE');
      assert.equal(recovery.canResume, false);
    });
  });
});
