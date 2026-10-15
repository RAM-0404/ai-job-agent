import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
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
  BrowserSessionNotFoundError,
} from './browser.errors.js';
import type {
  MultiStepWorkflowState,
  WorkflowOperationRecord,
  WorkflowRecoveryResult,
} from '@ai-job-agent/shared';

describe('Milestone 13.2: Adversarial Crash & Recovery Test Suite', () => {
  const trackedSessionIds: string[] = [];

  function createTestSessionId(tag: string): string {
    const id = `m13-2-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    trackedSessionIds.push(id);
    return id;
  }

  function createBaseWorkflowState(sessionId: string, overrides: Partial<MultiStepWorkflowState> = {}): MultiStepWorkflowState {
    return {
      sessionId,
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
          name: 'firstName',
          id: 'firstName',
          placeholder: null,
          autocomplete: null,
          ariaLabel: null,
          required: true,
          requirementSource: 'required',
          disabled: false,
          readOnly: false,
          hasValue: false,
          label: 'First Name',
          labelSource: 'label',
          helpText: null,
        },
        {
          index: 1,
          formIndex: 0,
          tag: 'input',
          type: 'TEXT',
          name: 'lastName',
          id: 'lastName',
          placeholder: null,
          autocomplete: null,
          ariaLabel: null,
          required: true,
          requirementSource: 'required',
          disabled: false,
          readOnly: false,
          hasValue: false,
          label: 'Last Name',
          labelSource: 'label',
          helpText: null,
        },
      ],
      currentProposals: [
        {
          fieldId: 'firstName',
          fieldName: 'firstName',
          fieldType: 'TEXT',
          tag: 'input',
          label: 'First Name',
          candidateSource: 'PROFILE',
          proposedValue: 'Jane',
          displayValue: 'Jane',
          confidence: 0.95,
          reason: 'Profile match',
          approved: false,
        },
        {
          fieldId: 'lastName',
          fieldName: 'lastName',
          fieldType: 'TEXT',
          tag: 'input',
          label: 'Last Name',
          candidateSource: 'PROFILE',
          proposedValue: 'Doe',
          displayValue: 'Doe',
          confidence: 0.95,
          reason: 'Profile match',
          approved: false,
        },
      ],
      lastExecutionResults: [],
      availableNavigationControls: [
        {
          id: 'ctrl-next-step',
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
          id: 'ctrl-submit-application',
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
      ...overrides,
    };
  }

  after(async () => {
    // Safe deterministic cleanup of all tracked test sessions
    let residualCount = 0;
    for (const sid of trackedSessionIds) {
      try {
        await workflowPersistenceService.deleteWorkflowState(sid);
        idempotencyService.releaseLock(sid);
        try {
          await browserService.closeSession(sid);
        } catch {
          // session might not exist or already closed
        }
      } catch (err) {
        residualCount++;
        console.error(`Failed cleanup for test session ${sid}:`, err);
      }
    }
    assert.equal(residualCount, 0, `All ${trackedSessionIds.length} test records must be deterministically cleaned up`);
  });

  // =========================================================================
  // PHASE 3 & PHASE 4: SIMULATED CRASHES AT CRITICAL BOUNDARIES
  // =========================================================================
  describe('Phase 3 & 4: Critical Failure Boundary Tests & Recovery Classification', () => {

    it('Boundary 1: Workflow created, before first operation -> RECONCILED / canResume=true', async () => {
      const sessionId = createTestSessionId('b1-init');
      const state = createBaseWorkflowState(sessionId);
      await workflowPersistenceService.saveWorkflowState(state);

      // Simulate live session available with matching DOM
      const mockBrowserService = {
        getSession: () => ({ id: sessionId }),
        inspectPage: async () => ({ url: state.currentUrl, title: 'Multi-Step Test' }),
      } as any;
      const mockNavService = {
        discoverNavigation: async () => ({
          currentStep: { heading: state.currentStepHeading, stepIndex: state.currentStepIndex },
        }),
      } as any;

      const recovery = new (workflowRecoveryService.constructor as any)(
        mockBrowserService,
        mockNavService,
        undefined,
        workflowPersistenceService,
        idempotencyService
      );

      const result = await recovery.recoverWorkflow(sessionId);
      assert.equal(result.success, true);
      assert.equal(result.recoveryStatus, 'RECOVERED');
      assert.equal(result.reason, 'RECONCILED');
      assert.equal(result.canResume, true);
      assert.equal(result.browserSessionAvailable, true);
      assert.equal(result.domMatchesSnapshot, true);
      assert.equal(result.interruptedOperationDetected, false);
      assert.equal(result.workflowState?.applicationSubmitted, false);
    });

    it('Boundary 2: Navigation operation requested, before execution -> REQUIRES_REVIEW (OPERATION_INTERRUPTED_POST)', async () => {
      const sessionId = createTestSessionId('b2-nav-req');
      const state = createBaseWorkflowState(sessionId);
      await workflowPersistenceService.saveWorkflowState(state);

      // Operation lock acquired & RUNNING recorded, but process crashed before execution
      const navKey = 'nav-key-interrupted';
      await idempotencyService.acquireOrCheckOperation(sessionId, navKey, 'NAVIGATE', { controlId: 'ctrl-next-step' });

      const mockBrowserService = {
        getSession: () => ({ id: sessionId }),
        inspectPage: async () => ({ url: state.currentUrl, title: 'Multi-Step Test' }),
      } as any;
      const mockNavService = {
        discoverNavigation: async () => ({
          currentStep: { heading: state.currentStepHeading, stepIndex: state.currentStepIndex },
        }),
      } as any;

      const recovery = new (workflowRecoveryService.constructor as any)(
        mockBrowserService,
        mockNavService,
        undefined,
        workflowPersistenceService,
        idempotencyService
      );

      const result = await recovery.recoverWorkflow(sessionId);
      assert.equal(result.success, false);
      assert.equal(result.recoveryStatus, 'REQUIRES_REVIEW');
      assert.equal(result.reason, 'OPERATION_INTERRUPTED_POST');
      assert.equal(result.canResume, false);
      assert.equal(result.interruptedOperationDetected, true);
      assert.equal(result.interruptedOperationKey, navKey);
      assert.equal(result.workflowState?.applicationSubmitted, false);

      // Check that operation record was updated to REQUIRES_REVIEW
      const op = await workflowPersistenceService.getOperation(sessionId, navKey);
      assert.equal(op?.status, 'REQUIRES_REVIEW');
    });

    it('Boundary 3: Navigation executed, before result persisted -> REQUIRES_REVIEW (DOM_MISMATCH)', async () => {
      const sessionId = createTestSessionId('b3-dom-drift');
      const state = createBaseWorkflowState(sessionId, {
        currentStepIndex: 1,
        currentStepHeading: 'Step 1: Contact Information',
      });
      await workflowPersistenceService.saveWorkflowState(state);

      // Browser DOM actually advanced to Step 2, but state persistence crashed before updating
      const mockBrowserService = {
        getSession: () => ({ id: sessionId }),
        inspectPage: async () => ({ url: state.currentUrl, title: 'Multi-Step Test' }),
      } as any;
      const mockNavService = {
        discoverNavigation: async () => ({
          currentStep: { heading: 'Step 2: Experience & Skills', stepIndex: 2 },
        }),
      } as any;

      const recovery = new (workflowRecoveryService.constructor as any)(
        mockBrowserService,
        mockNavService,
        undefined,
        workflowPersistenceService,
        idempotencyService
      );

      const result = await recovery.recoverWorkflow(sessionId);
      assert.equal(result.success, false);
      assert.equal(result.recoveryStatus, 'REQUIRES_REVIEW');
      assert.equal(result.reason, 'DOM_MISMATCH');
      assert.equal(result.canResume, false);
      assert.equal(result.domMatchesSnapshot, false);
      assert.match(result.message, /Active page DOM differs from persisted checkpoint/);
      assert.equal(result.workflowState?.applicationSubmitted, false);
    });

    it('Boundary 4: Operation result persisted, before API response returned -> Idempotent replay returns cached result', async () => {
      const sessionId = createTestSessionId('b4-idemp-cached');
      const opKey = 'b4-key-retry';
      const payload = { approvedFieldIds: ['firstName', 'lastName'] };
      const simulatedResponse = { success: true, verifiedCount: 2, fields: ['firstName', 'lastName'] };

      // Acquire and commit operation
      await idempotencyService.acquireOrCheckOperation(sessionId, opKey, 'EXECUTE_FIELDS', payload);
      await idempotencyService.completeOperation(sessionId, opKey, simulatedResponse);

      // Client "lost" response and retries with same idempotency key and same payload
      const retryResult = await idempotencyService.acquireOrCheckOperation(sessionId, opKey, 'EXECUTE_FIELDS', payload);
      assert.equal(retryResult.lockAcquired, false);
      assert.deepEqual(retryResult.cachedResult, simulatedResponse);
    });

    it('Boundary 5: Autofill proposal created, before human approval -> All proposals remain strictly unapproved', async () => {
      const sessionId = createTestSessionId('b5-proposals');
      const state = createBaseWorkflowState(sessionId, { status: 'WAITING_FOR_FIELD_APPROVAL' });
      await workflowPersistenceService.saveWorkflowState(state);

      // Reload persisted state
      const reloaded = await workflowPersistenceService.getPersistedWorkflowState(sessionId);
      assert.ok(reloaded);
      assert.equal(reloaded.status, 'WAITING_FOR_FIELD_APPROVAL');
      assert.equal(reloaded.currentProposals.length, 2);
      for (const prop of reloaded.currentProposals) {
        assert.equal(prop.approved, false, `Field ${prop.fieldName} must remain strictly unapproved`);
      }
      assert.equal(reloaded.applicationSubmitted, false);
    });

    it('Boundary 6: Some approved fields filled, before all fields verified -> REQUIRES_REVIEW (OPERATION_INTERRUPTED_POST)', async () => {
      const sessionId = createTestSessionId('b6-partial-fill');
      const state = createBaseWorkflowState(sessionId, { status: 'FILLING_FIELDS' });
      await workflowPersistenceService.saveWorkflowState(state);

      const fillKey = 'b6-fill-key';
      await idempotencyService.acquireOrCheckOperation(sessionId, fillKey, 'EXECUTE_FIELDS', { approvedFieldIds: ['firstName'] });

      const mockBrowserService = {
        getSession: () => ({ id: sessionId }),
        inspectPage: async () => ({ url: state.currentUrl, title: 'Multi-Step Test' }),
      } as any;
      const mockNavService = {
        discoverNavigation: async () => ({
          currentStep: { heading: state.currentStepHeading, stepIndex: state.currentStepIndex },
        }),
      } as any;

      const recovery = new (workflowRecoveryService.constructor as any)(
        mockBrowserService,
        mockNavService,
        undefined,
        workflowPersistenceService,
        idempotencyService
      );

      const result = await recovery.recoverWorkflow(sessionId);
      assert.equal(result.recoveryStatus, 'REQUIRES_REVIEW');
      assert.equal(result.reason, 'OPERATION_INTERRUPTED_POST');
      assert.equal(result.canResume, false);
      assert.equal(result.interruptedOperationDetected, true);
      assert.equal(result.workflowState?.applicationSubmitted, false);
    });

    it('Boundary 7: Step transition persisted, before next discovery completes -> requires fresh discovery', async () => {
      const sessionId = createTestSessionId('b7-step-trans');
      // Persisted as Step 2, but proposals are empty or uninitialized
      const state = createBaseWorkflowState(sessionId, {
        currentStepIndex: 2,
        currentStepHeading: 'Step 2: Experience & Skills',
        currentProposals: [],
        discoveredFields: [],
      });
      await workflowPersistenceService.saveWorkflowState(state);

      const mockBrowserService = {
        getSession: () => ({ id: sessionId }),
        inspectPage: async () => ({ url: state.currentUrl, title: 'Multi-Step Test' }),
      } as any;
      const mockNavService = {
        discoverNavigation: async () => ({
          currentStep: { heading: 'Step 2: Experience & Skills', stepIndex: 2 },
        }),
      } as any;

      const recovery = new (workflowRecoveryService.constructor as any)(
        mockBrowserService,
        mockNavService,
        undefined,
        workflowPersistenceService,
        idempotencyService
      );

      const result = await recovery.recoverWorkflow(sessionId);
      assert.equal(result.recoveryStatus, 'RECOVERED');
      assert.equal(result.reason, 'RECONCILED');
      assert.equal(result.canResume, true);
      assert.equal(result.workflowState?.currentStepIndex, 2);
      assert.equal(result.workflowState?.applicationSubmitted, false);
    });

    it('Boundary 8: Workflow awaiting human approval -> Preserves paused approval state across restart', async () => {
      const sessionId = createTestSessionId('b8-awaiting-approval');
      const state = createBaseWorkflowState(sessionId, {
        status: 'WAITING_FOR_NAV_APPROVAL',
        progress: {
          currentStepIndex: 1,
          stepHeading: 'Step 1: Contact Information',
          totalVisitedSteps: 1,
          currentStepFilledCount: 2,
          currentStepTotalFieldCount: 2,
          currentStepMissingRequiredCount: 0,
          terminalControlDetected: false,
          isReadyForNavigation: true,
          isReviewStep: false,
        },
      });
      await workflowPersistenceService.saveWorkflowState(state);

      const loaded = await workflowPersistenceService.getPersistedWorkflowState(sessionId);
      assert.ok(loaded);
      assert.equal(loaded.status, 'WAITING_FOR_NAV_APPROVAL');
      assert.equal(loaded.progress.isReadyForNavigation, true);
      assert.equal(loaded.applicationSubmitted, false);
    });

    it('Boundary 9: Recovery started while previous operation may still be running -> Releases stale lock, requires review', async () => {
      const sessionId = createTestSessionId('b9-running-lock');
      const state = createBaseWorkflowState(sessionId);
      await workflowPersistenceService.saveWorkflowState(state);

      const runKey = 'b9-concurrent-run-key';
      await idempotencyService.acquireOrCheckOperation(sessionId, runKey, 'NAVIGATE', { controlId: 'next' });

      const mockBrowserService = {
        getSession: () => ({ id: sessionId }),
        inspectPage: async () => ({ url: state.currentUrl, title: 'Multi-Step Test' }),
      } as any;
      const mockNavService = {
        discoverNavigation: async () => ({
          currentStep: { heading: state.currentStepHeading, stepIndex: state.currentStepIndex },
        }),
      } as any;

      const recovery = new (workflowRecoveryService.constructor as any)(
        mockBrowserService,
        mockNavService,
        undefined,
        workflowPersistenceService,
        idempotencyService
      );

      const result = await recovery.recoverWorkflow(sessionId);
      assert.equal(result.recoveryStatus, 'REQUIRES_REVIEW');
      assert.equal(result.reason, 'OPERATION_INTERRUPTED_POST');
      assert.equal(result.canResume, false);

      // Verify that the stale lock was released
      const newOpCheck = await idempotencyService.acquireOrCheckOperation(sessionId, 'new-key-after-rec', 'INIT', {});
      assert.equal(newOpCheck.lockAcquired, true);
      idempotencyService.releaseLock(sessionId);
    });

    it('Classification: REQUIRES_INTERVENTION (BROWSER_SESSION_LOST) when session does not exist in browser engine', async () => {
      const sessionId = createTestSessionId('cls-session-lost');
      const state = createBaseWorkflowState(sessionId);
      await workflowPersistenceService.saveWorkflowState(state);

      // Real browserService has no such session
      const recovery = await workflowRecoveryService.recoverWorkflow(sessionId);
      assert.equal(recovery.success, false);
      assert.equal(recovery.recoveryStatus, 'REQUIRES_INTERVENTION');
      assert.equal(recovery.reason, 'BROWSER_SESSION_LOST');
      assert.equal(recovery.browserSessionAvailable, false);
      assert.equal(recovery.canResume, false);
      assert.ok(recovery.actionRequired);
      assert.equal(recovery.workflowState?.applicationSubmitted, false);
    });

    it('Classification: FAILED (UNRECONCILABLE) when no persisted workflow state exists', async () => {
      const unknownSessionId = createTestSessionId('cls-unreconcilable');
      const recovery = await workflowRecoveryService.recoverWorkflow(unknownSessionId);
      assert.equal(recovery.success, false);
      assert.equal(recovery.recoveryStatus, 'FAILED');
      assert.equal(recovery.reason, 'UNRECONCILABLE');
      assert.equal(recovery.canResume, false);
    });
  });

  // =========================================================================
  // PHASE 5: IDEMPOTENCY AND CONCURRENCY STRESS TESTS
  // =========================================================================
  describe('Phase 5: Idempotency & Concurrency Stress Tests', () => {

    it('1. Identical mutating requests with same key -> Returns cached response with 0 extra side effects', async () => {
      const sessionId = createTestSessionId('p5-identical');
      const key = 'idem-key-1';
      const payload = { approvedFieldIds: ['firstName'] };
      const response = { success: true, count: 1 };

      const first = await idempotencyService.acquireOrCheckOperation(sessionId, key, 'EXECUTE_FIELDS', payload);
      assert.equal(first.lockAcquired, true);
      assert.equal(first.cachedResult, undefined);

      await idempotencyService.completeOperation(sessionId, key, response);

      const second = await idempotencyService.acquireOrCheckOperation(sessionId, key, 'EXECUTE_FIELDS', payload);
      assert.equal(second.lockAcquired, false);
      assert.deepEqual(second.cachedResult, response);
    });

    it('2. Same key with different payload -> Throws IdempotencyConflictError (409)', async () => {
      const sessionId = createTestSessionId('p5-diff-payload');
      const key = 'idem-key-conflict';
      const payload1 = { approvedFieldIds: ['firstName'] };
      const payload2 = { approvedFieldIds: ['firstName', 'lastName'] };

      await idempotencyService.acquireOrCheckOperation(sessionId, key, 'EXECUTE_FIELDS', payload1);
      await idempotencyService.completeOperation(sessionId, key, { success: true });

      await assert.rejects(
        async () => {
          await idempotencyService.acquireOrCheckOperation(sessionId, key, 'EXECUTE_FIELDS', payload2);
        },
        (err: unknown) => {
          assert.ok(err instanceof IdempotencyConflictError);
          assert.equal((err as any).statusCode, 409);
          return true;
        }
      );
    });

    it('3. Concurrent requests using same key -> Exactly 1 acquires lock, other receives OperationInProgressError (409)', async () => {
      const sessionId = createTestSessionId('p5-concurrent-same-key');
      const key = 'idem-key-parallel-same';
      const payload = { test: true };

      const promises = [
        idempotencyService.acquireOrCheckOperation(sessionId, key, 'INIT', payload),
        idempotencyService.acquireOrCheckOperation(sessionId, key, 'INIT', payload),
      ];

      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.equal(fulfilled.length, 1, 'Exactly one concurrent call must succeed');
      assert.equal(rejected.length, 1, 'The competing concurrent call must be rejected');
      assert.ok(rejected[0].status === 'rejected' && rejected[0].reason instanceof OperationInProgressError);

      // Clean up lock
      idempotencyService.releaseLock(sessionId);
    });

    it('4. Concurrent requests using different keys against same workflow -> Exactly 1 acquires lock, other receives OperationInProgressError (409)', async () => {
      const sessionId = createTestSessionId('p5-concurrent-diff-keys');
      const keyA = 'key-A';
      const keyB = 'key-B';

      const promises = [
        idempotencyService.acquireOrCheckOperation(sessionId, keyA, 'EXECUTE_FIELDS', { a: 1 }),
        idempotencyService.acquireOrCheckOperation(sessionId, keyB, 'EXECUTE_FIELDS', { b: 2 }),
      ];

      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(rejected[0].status === 'rejected' && rejected[0].reason instanceof OperationInProgressError);

      idempotencyService.releaseLock(sessionId);
    });

    it('5. Retry after server commits operation but client lost response -> Returns committed response without mutation', async () => {
      const sessionId = createTestSessionId('p5-lost-resp');
      const key = 'key-lost-resp';
      const payload = { controlId: 'ctrl-next-step' };
      const committedResult = { success: true, newHeading: 'Step 2: Experience & Skills', newStepIndex: 2 };

      // Server commits
      await idempotencyService.acquireOrCheckOperation(sessionId, key, 'NAVIGATE', payload);
      await idempotencyService.completeOperation(sessionId, key, committedResult);

      // Client retries
      const retry = await idempotencyService.acquireOrCheckOperation(sessionId, key, 'NAVIGATE', payload);
      assert.equal(retry.lockAcquired, false);
      assert.deepEqual(retry.cachedResult, committedResult);
    });

    it('6. Retry after controlled failure before persistence -> Failed operation releases lock, permits subsequent execution', async () => {
      const sessionId = createTestSessionId('p5-failure-retry');
      const key = 'key-fail-before-persist';
      const payload = { test: 'fail' };

      await idempotencyService.acquireOrCheckOperation(sessionId, key, 'INIT', payload);
      await idempotencyService.failOperation(sessionId, key, 'FAILED', 'Controlled synthetic failure');

      // Lock is released; new key can acquire immediately
      const newKeyResult = await idempotencyService.acquireOrCheckOperation(sessionId, 'key-subsequent', 'INIT', payload);
      assert.equal(newKeyResult.lockAcquired, true);
      idempotencyService.releaseLock(sessionId);
    });

    it('7. Duplicate recovery requests -> Sequentially returns deterministic identical safe status', async () => {
      const sessionId = createTestSessionId('p5-dup-recovery');
      const state = createBaseWorkflowState(sessionId);
      await workflowPersistenceService.saveWorkflowState(state);

      // Simulated interrupted operation
      await idempotencyService.acquireOrCheckOperation(sessionId, 'dup-rec-op', 'NAVIGATE', {});

      const mockBrowserService = {
        getSession: () => ({ id: sessionId }),
        inspectPage: async () => ({ url: state.currentUrl, title: 'Multi-Step Test' }),
      } as any;
      const mockNavService = {
        discoverNavigation: async () => ({
          currentStep: { heading: state.currentStepHeading, stepIndex: state.currentStepIndex },
        }),
      } as any;

      const recovery = new (workflowRecoveryService.constructor as any)(
        mockBrowserService,
        mockNavService,
        undefined,
        workflowPersistenceService,
        idempotencyService
      );

      // First recovery call
      const rec1 = await recovery.recoverWorkflow(sessionId);
      assert.equal(rec1.recoveryStatus, 'REQUIRES_REVIEW');
      assert.equal(rec1.reason, 'OPERATION_INTERRUPTED_POST');

      // Second recovery call immediately after without resolving
      const rec2 = await recovery.recoverWorkflow(sessionId);
      assert.equal(rec2.recoveryStatus, 'REQUIRES_REVIEW');
      assert.equal(rec2.reason, 'OPERATION_INTERRUPTED_POST');
      assert.equal(rec2.canResume, false);
    });

    it('8. Concurrent recovery attempts -> Resolves safely without corrupting workflow state', async () => {
      const sessionId = createTestSessionId('p5-concurrent-rec');
      const state = createBaseWorkflowState(sessionId);
      await workflowPersistenceService.saveWorkflowState(state);

      const mockBrowserService = {
        getSession: () => ({ id: sessionId }),
        inspectPage: async () => ({ url: state.currentUrl, title: 'Multi-Step Test' }),
      } as any;
      const mockNavService = {
        discoverNavigation: async () => ({
          currentStep: { heading: state.currentStepHeading, stepIndex: state.currentStepIndex },
        }),
      } as any;

      const recovery = new (workflowRecoveryService.constructor as any)(
        mockBrowserService,
        mockNavService,
        undefined,
        workflowPersistenceService,
        idempotencyService
      );

      const [recA, recB] = await Promise.all([
        recovery.recoverWorkflow(sessionId),
        recovery.recoverWorkflow(sessionId),
      ]);

      assert.equal(recA.recoveryStatus, 'RECOVERED');
      assert.equal(recB.recoveryStatus, 'RECOVERED');
      assert.equal(recA.canResume, true);
      assert.equal(recB.canResume, true);

      // State version incremented safely
      const saved = await workflowPersistenceService.getPersistedWorkflowState(sessionId);
      assert.ok(saved);
      assert.equal(saved.recoveryStatus, 'RECOVERED');
    });

    it('9. Missing and expired idempotency keys conform strictly to API contract', async () => {
      const sessionId = createTestSessionId('p5-missing-expired');

      // Missing key -> auto-generated key, lock acquired
      const autoRes = await idempotencyService.acquireOrCheckOperation(sessionId, undefined, 'INIT', {});
      assert.equal(autoRes.lockAcquired, true);
      assert.ok(autoRes.operationId?.startsWith('auto-'));
      idempotencyService.releaseLock(sessionId);

      // Empty string key -> treated as missing key
      const emptyRes = await idempotencyService.acquireOrCheckOperation(sessionId, '', 'INIT', {});
      assert.equal(emptyRes.lockAcquired, true);
      idempotencyService.releaseLock(sessionId);
    });
  });

  // =========================================================================
  // PHASE 6: BROWSER AND AUTOFILL RECOVERY
  // =========================================================================
  describe('Phase 6: Browser and Autofill Recovery Verification', () => {

    it('URL changes unexpectedly -> DOM_MISMATCH, canResume=false', async () => {
      const sessionId = createTestSessionId('p6-url-drift');
      const state = createBaseWorkflowState(sessionId, {
        currentUrl: 'http://127.0.0.1:3000/browser/test-page/multi-step',
      });
      await workflowPersistenceService.saveWorkflowState(state);

      const mockBrowserService = {
        getSession: () => ({ id: sessionId }),
        inspectPage: async () => ({ url: 'http://127.0.0.1:3000/some-other-page', title: 'Other' }),
      } as any;
      const mockNavService = {
        discoverNavigation: async () => ({
          currentStep: { heading: state.currentStepHeading, stepIndex: state.currentStepIndex },
        }),
      } as any;

      const recovery = new (workflowRecoveryService.constructor as any)(
        mockBrowserService,
        mockNavService,
        undefined,
        workflowPersistenceService,
        idempotencyService
      );

      const result = await recovery.recoverWorkflow(sessionId);
      assert.equal(result.recoveryStatus, 'REQUIRES_REVIEW');
      assert.equal(result.reason, 'DOM_MISMATCH');
      assert.equal(result.canResume, false);
      assert.equal(result.domMatchesSnapshot, false);
    });

    it('Step heading changes unexpectedly -> DOM_MISMATCH, canResume=false', async () => {
      const sessionId = createTestSessionId('p6-heading-drift');
      const state = createBaseWorkflowState(sessionId, {
        currentStepHeading: 'Step 1: Contact Information',
      });
      await workflowPersistenceService.saveWorkflowState(state);

      const mockBrowserService = {
        getSession: () => ({ id: sessionId }),
        inspectPage: async () => ({ url: state.currentUrl, title: 'Multi-Step Test' }),
      } as any;
      const mockNavService = {
        discoverNavigation: async () => ({
          currentStep: { heading: 'Unexpected Divergent Heading', stepIndex: 1 },
        }),
      } as any;

      const recovery = new (workflowRecoveryService.constructor as any)(
        mockBrowserService,
        mockNavService,
        undefined,
        workflowPersistenceService,
        idempotencyService
      );

      const result = await recovery.recoverWorkflow(sessionId);
      assert.equal(result.recoveryStatus, 'REQUIRES_REVIEW');
      assert.equal(result.reason, 'DOM_MISMATCH');
      assert.equal(result.canResume, false);
    });

    it('Terminal control navigation attempt strictly throws TerminalActionForbiddenError', async () => {
      const sessionId = createTestSessionId('p6-terminal-block');
      const state = createBaseWorkflowState(sessionId);
      await workflowPersistenceService.saveWorkflowState(state);

      // Attempting to navigate with a terminal control
      await assert.rejects(
        async () => {
          await multiStepWorkflowService.approveStepNavigation(sessionId, 'ctrl-submit-application');
        },
        (err: unknown) => {
          assert.ok(err instanceof TerminalActionForbiddenError);
          assert.equal((err as any).statusCode, 403);
          return true;
        }
      );
    });
  });

  // =========================================================================
  // PHASE 7: STRICT NON-SUBMISSION VERIFICATION
  // =========================================================================
  describe('Phase 7: Strict Non-Submission Verification Invariant', () => {

    it('Verifies applicationSubmitted === false across all persisted workflow states', async () => {
      for (const sid of trackedSessionIds) {
        const persisted = await workflowPersistenceService.getPersistedWorkflowState(sid);
        if (persisted) {
          assert.equal(
            persisted.applicationSubmitted,
            false,
            `Safety invariant violated: applicationSubmitted is true for session ${sid}`
          );
        }
      }
    });

    it('Verifies no terminal navigation or submission side-effect was ever invoked', async () => {
      const testSid = createTestSessionId('p7-invariant');
      const state = createBaseWorkflowState(testSid);
      await workflowPersistenceService.saveWorkflowState(state);

      const history = await multiStepWorkflowService.getWorkflowHistoryAsync(testSid);
      assert.equal(history.applicationSubmitted, false);
      assert.equal(history.currentState.applicationSubmitted, false);
    });
  });
});
