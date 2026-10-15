import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../../server.js';
import type { FastifyInstance } from 'fastify';
import { browserService } from './browser.service.js';
import { multiStepWorkflowService } from './multi-step-workflow.service.js';
import {
  TerminalActionForbiddenError,
  NavigationControlNotFoundError,
  BrowserOperationError,
} from './browser.errors.js';

describe('MultiStepWorkflowService Unit & Integration Tests (Milestone 12.2)', () => {
  let app: FastifyInstance;
  let serverPort: number;
  let multiStepUrl: string;
  let sessionId: string;

  before(async () => {
    app = await buildServer();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const match = address.match(/:(\d+)$/);
    serverPort = match ? Number(match[1]) : 3000;
    multiStepUrl = `http://127.0.0.1:${serverPort}/browser/test-page/multi-step`;

    const session = await browserService.createSession();
    sessionId = session.sessionId;
    await browserService.navigate(sessionId, multiStepUrl);
  });

  after(async () => {
    if (sessionId) {
      await browserService.closeSession(sessionId).catch(() => {});
    }
    await browserService.closeBrowser();
    await app.close();
  });

  describe('Step 1 Initialization & Autofill Execution', () => {
    test('initializes multi-step workflow on Step 1', async () => {
      const state = await multiStepWorkflowService.initWorkflow(sessionId);

      assert.equal(state.sessionId, sessionId);
      assert.equal(state.currentStepIndex, 1);
      assert.ok(state.currentStepHeading?.includes('Step 1'));
      assert.equal(state.discoveredFields.length, 3); // fullName, email, phone
      assert.equal(state.stepHistory.length, 1);
      assert.equal(state.applicationSubmitted, false);

      // Verify all proposals start unapproved (approved = false)
      for (const prop of state.currentProposals) {
        assert.equal(prop.approved, false, `Field ${prop.fieldId} must start unapproved`);
      }

      // Verify Next button detected
      const nextCtrl = state.availableNavigationControls.find((c) => c.direction === 'FORWARD');
      assert.ok(nextCtrl, 'Forward navigation control must exist on Step 1');
      assert.equal(nextCtrl.isExecutable, true);
      assert.equal(state.terminalControlDetected, false);
    });

    test('retrieves active workflow state', () => {
      const state = multiStepWorkflowService.getWorkflowState(sessionId);
      assert.equal(state.sessionId, sessionId);
      assert.equal(state.currentStepIndex, 1);
    });

    test('handles partial field approval: approved fields populated, unapproved fields skipped', async () => {
      const state = multiStepWorkflowService.getWorkflowState(sessionId);
      const fullNameProp = state.currentProposals.find((p) => p.fieldName === 'fullName');
      assert.ok(fullNameProp, 'fullName proposal must exist');

      // Operator only approves fullName; skips email and phone
      const execResult = await multiStepWorkflowService.executeStepFields(sessionId, {
        approvedFieldIds: [fullNameProp.fieldId],
      });

      assert.equal(execResult.success, true);
      assert.equal(execResult.stepIndex, 1);
      assert.equal(execResult.applicationSubmitted, false);

      const fullNameResult = execResult.results.find((r) => r.fieldId === fullNameProp.fieldId);
      assert.ok(fullNameResult);
      assert.equal(fullNameResult.status, 'SUCCESS');
      assert.equal(fullNameResult.verified, true);

      // Check unapproved fields are skipped
      const skippedResults = execResult.results.filter((r) => r.status === 'SKIPPED');
      assert.ok(skippedResults.length >= 1, 'Unapproved fields must have SKIPPED status');

      // Missing required field check: email was required and skipped
      assert.ok(
        execResult.missingRequiredFields.some((f) => f.toLowerCase().includes('email')),
        'Missing required fields must include Email'
      );
      assert.equal(execResult.canNavigateForward, true);
    });

    test('approves remaining required fields and re-verifies Step 1', async () => {
      const state = multiStepWorkflowService.getWorkflowState(sessionId);
      const emailProp = state.currentProposals.find((p) => p.fieldName === 'email');
      assert.ok(emailProp);

      const execResult = await multiStepWorkflowService.executeStepFields(sessionId, {
        approvedFieldIds: [emailProp.fieldId],
      });

      assert.equal(execResult.success, true);
      const emailResult = execResult.results.find((r) => r.fieldId === emailProp.fieldId);
      assert.ok(emailResult);
      assert.equal(emailResult.status, 'SUCCESS');
      assert.equal(emailResult.verified, true);
    });
  });

  describe('Step 1 to Step 2 Navigation Progression', () => {
    test('explicitly approves Next navigation and advances to Step 2', async () => {
      const stateBefore = multiStepWorkflowService.getWorkflowState(sessionId);
      const nextCtrl = stateBefore.availableNavigationControls.find((c) => c.direction === 'FORWARD');
      assert.ok(nextCtrl);

      const navResponse = await multiStepWorkflowService.approveStepNavigation(sessionId, nextCtrl.id);

      assert.equal(navResponse.success, true);
      assert.equal(navResponse.previousStepIndex, 1);
      assert.equal(navResponse.currentStepIndex, 2);
      assert.ok(navResponse.newHeading?.includes('Step 2'));
      assert.equal(navResponse.applicationSubmitted, false);

      // Check new fields discovered on Step 2
      assert.equal(navResponse.rediscoveredFieldCount, 3); // experienceYears, location, workMode
      assert.equal(navResponse.workflowState.stepHistory.length, 2);

      // Step 1 marked completed
      assert.equal(navResponse.workflowState.stepHistory[0].completed, true);
      assert.equal(navResponse.workflowState.stepHistory[0].stepIndex, 1);

      // Step 2 new proposals must strictly start unapproved!
      for (const prop of navResponse.newProposals) {
        assert.equal(prop.approved, false, 'New step proposals must require fresh approval');
      }

      // Step 2 controls: Back and Continue
      const backCtrl = navResponse.availableNavigationControls.find((c) => c.direction === 'BACKWARD');
      const continueCtrl = navResponse.availableNavigationControls.find((c) => c.direction === 'FORWARD');
      assert.ok(backCtrl, 'Back control must exist on Step 2');
      assert.ok(continueCtrl, 'Continue control must exist on Step 2');
    });

    test('executes field filling on Step 2 with fresh human approval', async () => {
      const state = multiStepWorkflowService.getWorkflowState(sessionId);
      assert.equal(state.currentStepIndex, 2);

      // Approve location and workMode
      const locProp = state.currentProposals.find((p) => p.fieldName === 'location');
      const approvedIds = locProp ? [locProp.fieldId] : [];

      const execResult = await multiStepWorkflowService.executeStepFields(sessionId, {
        approvedFieldIds: approvedIds,
      });

      assert.equal(execResult.success, true);
      assert.equal(execResult.stepIndex, 2);
      assert.equal(execResult.applicationSubmitted, false);
    });
  });

  describe('Step 2 to Step 3 Progression & Terminal Safety Enforcement', () => {
    test('explicitly approves Continue navigation and advances to Step 3', async () => {
      const stateBefore = multiStepWorkflowService.getWorkflowState(sessionId);
      const continueCtrl = stateBefore.availableNavigationControls.find((c) => c.direction === 'FORWARD');
      assert.ok(continueCtrl);

      const navResponse = await multiStepWorkflowService.approveStepNavigation(sessionId, continueCtrl.id);

      assert.equal(navResponse.success, true);
      assert.equal(navResponse.currentStepIndex, 3);
      assert.ok(navResponse.newHeading?.includes('Step 3'));
      assert.equal(navResponse.workflowState.stepHistory.length, 3);

      // Verify Step 3 terminal control detection
      assert.equal(navResponse.terminalControlDetected, true);
      assert.equal(navResponse.applicationSubmitted, false);

      const submitCtrl = navResponse.availableNavigationControls.find((c) => c.isTerminal);
      assert.ok(submitCtrl, 'Terminal Submit button must be detected on Step 3');
      assert.equal(submitCtrl.isExecutable, false, 'Terminal control must NOT be executable');
      assert.equal(submitCtrl.isTerminal, true);
    });

    test('CRITICAL: strictly rejects attempt to approve terminal Submit control with 403 Forbidden', async () => {
      const state = multiStepWorkflowService.getWorkflowState(sessionId);
      const submitCtrl = state.availableNavigationControls.find((c) => c.isTerminal);
      assert.ok(submitCtrl);

      await assert.rejects(
        async () => {
          await multiStepWorkflowService.approveStepNavigation(sessionId, submitCtrl.id);
        },
        (err: unknown) => {
          assert.ok(err instanceof TerminalActionForbiddenError);
          assert.equal(err.code, 'TERMINAL_ACTION_FORBIDDEN');
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    });

    test('rejects non-existent navigation controlId with 404', async () => {
      await assert.rejects(
        async () => {
          await multiStepWorkflowService.approveStepNavigation(sessionId, 'invalid-non-existent-control');
        },
        (err: unknown) => {
          assert.ok(err instanceof NavigationControlNotFoundError);
          assert.equal(err.statusCode, 404);
          return true;
        }
      );
    });

    test('retrieves full cumulative workflow history across all completed steps', () => {
      const history = multiStepWorkflowService.getWorkflowHistory(sessionId);

      assert.equal(history.sessionId, sessionId);
      assert.equal(history.applicationSubmitted, false);
      assert.ok(history.totalStepsCompleted >= 2, 'At least 2 steps were navigated past');
      assert.equal(history.stepHistory.length, 3);

      // Verify Step 1 history details
      const step1Record = history.stepHistory.find((s) => s.stepIndex === 1);
      assert.ok(step1Record);
      assert.equal(step1Record.completed, true);
      assert.ok(step1Record.executionResults.length > 0);

      // Verify Step 2 history details
      const step2Record = history.stepHistory.find((s) => s.stepIndex === 2);
      assert.ok(step2Record);
      assert.equal(step2Record.completed, true);

      // Verify Step 3 history details
      const step3Record = history.stepHistory.find((s) => s.stepIndex === 3);
      assert.ok(step3Record);
      assert.equal(step3Record.completed, false);
    });

    test('verifies submission counter on test fixture remains strictly 0', async () => {
      const res = await fetch(`http://127.0.0.1:${serverPort}/browser/test-page/multi-step/submission-status`);
      const body = await res.json() as { submissionCount: number; applicationSubmitted: boolean };

      assert.equal(body.submissionCount, 0, 'Form submission counter must be strictly 0');
      assert.equal(body.applicationSubmitted, false, 'applicationSubmitted must be FALSE');
    });
  });
});
