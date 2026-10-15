import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../../server.js';
import type { FastifyInstance } from 'fastify';
import { browserService } from './browser.service.js';
import { browserNavigationService } from './browser-navigation.service.js';
import {
  TerminalActionForbiddenError,
  NavigationControlNotFoundError,
  BrowserSessionNotFoundError,
} from './browser.errors.js';

describe('BrowserNavigationService Unit & Integration Tests (Milestone 12.1)', () => {
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

    // Create a real session for integration testing
    const session = await browserService.createSession();
    sessionId = session.sessionId;
  });

  after(async () => {
    if (sessionId) {
      await browserService.closeSession(sessionId).catch(() => {});
    }
    await browserService.closeBrowser();
    await app.close();
  });

  describe('Control Normalization and Classification', () => {
    test('normalizes button text and labels correctly', () => {
      assert.equal(browserNavigationService.normalizeLabel('  Next   Step  '), 'next step');
      assert.equal(browserNavigationService.normalizeLabel('SUBMIT\n APPLICATION '), 'submit application');
      assert.equal(browserNavigationService.normalizeLabel(' Go  Back '), 'go back');
    });

    test('classifies NEXT controls accurately', () => {
      const c1 = browserNavigationService.classifyControl({ text: 'Next', ariaLabel: null, type: 'button', value: null });
      assert.equal(c1.type, 'NEXT');
      assert.equal(c1.direction, 'FORWARD');
      assert.equal(c1.isExecutable, true);
      assert.equal(c1.isTerminal, false);

      const c2 = browserNavigationService.classifyControl({ text: 'Next Step', ariaLabel: null, type: 'button', value: null });
      assert.equal(c2.type, 'NEXT');
      assert.equal(c2.isExecutable, true);
      assert.equal(c2.isTerminal, false);

      const c3 = browserNavigationService.classifyControl({ text: 'Proceed', ariaLabel: null, type: 'button', value: null });
      assert.equal(c3.type, 'NEXT');
      assert.equal(c3.isExecutable, true);
    });

    test('classifies CONTINUE controls accurately', () => {
      const c1 = browserNavigationService.classifyControl({ text: 'Continue', ariaLabel: null, type: 'button', value: null });
      assert.equal(c1.type, 'CONTINUE');
      assert.equal(c1.direction, 'FORWARD');
      assert.equal(c1.isExecutable, true);
      assert.equal(c1.isTerminal, false);

      const c2 = browserNavigationService.classifyControl({ text: 'Save and continue', ariaLabel: null, type: 'button', value: null });
      assert.equal(c2.type, 'CONTINUE');
      assert.equal(c2.isExecutable, true);
      assert.equal(c2.isTerminal, false);

      const c3 = browserNavigationService.classifyControl({ text: 'Continue to next step', ariaLabel: null, type: 'button', value: null });
      assert.equal(c3.type, 'CONTINUE');
      assert.equal(c3.isExecutable, true);
    });

    test('classifies PREVIOUS and BACK controls accurately', () => {
      const c1 = browserNavigationService.classifyControl({ text: 'Back', ariaLabel: null, type: 'button', value: null });
      assert.equal(c1.type, 'BACK');
      assert.equal(c1.direction, 'BACKWARD');
      assert.equal(c1.isExecutable, true);
      assert.equal(c1.isTerminal, false);

      const c2 = browserNavigationService.classifyControl({ text: 'Previous', ariaLabel: null, type: 'button', value: null });
      assert.equal(c2.type, 'PREVIOUS');
      assert.equal(c2.direction, 'BACKWARD');
      assert.equal(c2.isExecutable, true);
      assert.equal(c2.isTerminal, false);

      const c3 = browserNavigationService.classifyControl({ text: 'Go Back', ariaLabel: null, type: 'button', value: null });
      assert.equal(c3.type, 'BACK');
      assert.equal(c3.direction, 'BACKWARD');
      assert.equal(c3.isExecutable, true);
    });

    test('classifies REVIEW controls accurately', () => {
      const c1 = browserNavigationService.classifyControl({ text: 'Review', ariaLabel: null, type: 'button', value: null });
      assert.equal(c1.type, 'REVIEW');
      assert.equal(c1.direction, 'REVIEW');
      assert.equal(c1.isExecutable, true);
      assert.equal(c1.isTerminal, false);

      const c2 = browserNavigationService.classifyControl({ text: 'Review Application', ariaLabel: null, type: 'button', value: null });
      assert.equal(c2.type, 'REVIEW');
      assert.equal(c2.direction, 'REVIEW');
      assert.equal(c2.isExecutable, true);
      assert.equal(c2.isTerminal, false);
    });

    test('classifies TERMINAL controls accurately and marks them non-executable', () => {
      const labels = [
        'Submit',
        'Submit Application',
        'Apply',
        'Apply Now',
        'Finish Application',
        'Complete Application',
        'Send Application',
        'Finalize Application',
      ];

      for (const label of labels) {
        const c = browserNavigationService.classifyControl({ text: label, ariaLabel: null, type: 'submit', value: null });
        assert.equal(c.type, 'TERMINAL', `Expected ${label} to be classified as TERMINAL`);
        assert.equal(c.direction, 'TERMINAL');
        assert.equal(c.isExecutable, false, `Expected ${label} isExecutable to be FALSE`);
        assert.equal(c.isTerminal, true, `Expected ${label} isTerminal to be TRUE`);
      }
    });

    test('classifies input type="submit" as TERMINAL', () => {
      const c = browserNavigationService.classifyControl({ text: '', ariaLabel: null, type: 'submit', value: 'Submit Application' });
      assert.equal(c.type, 'TERMINAL');
      assert.equal(c.isExecutable, false);
      assert.equal(c.isTerminal, true);
    });

    test('classifies unknown buttons as UNKNOWN and non-executable', () => {
      const c = browserNavigationService.classifyControl({ text: 'Random Action', ariaLabel: null, type: 'button', value: null });
      assert.equal(c.type, 'UNKNOWN');
      assert.equal(c.isExecutable, false);
      assert.equal(c.isTerminal, false);
    });
  });

  describe('Multi-Step Navigation Lifecycle & Safety Enforcement', () => {
    test('throws BrowserSessionNotFoundError for non-existent session', () => {
      assert.throws(
        () => browserNavigationService.getNavigationState('non-existent-uuid'),
        BrowserSessionNotFoundError
      );
    });

    test('discovers Step 1 on the deterministic multi-step fixture', async () => {
      const state = await browserNavigationService.discoverNavigation(sessionId, multiStepUrl);

      assert.ok(state);
      assert.equal(state.sessionId, sessionId);
      assert.ok(state.currentStep);
      assert.equal(state.currentStep.stepIndex, 1);
      assert.ok(state.currentStep.heading?.includes('Step 1'));
      assert.equal(state.currentStep.discoveredFieldCount, 3); // fullName, email, phone
      assert.equal(state.currentStep.requiredFieldCount, 2); // fullName, email

      // Verify Next button detected
      const nextCtrl = state.currentStep.controls.find((c) => c.type === 'NEXT');
      assert.ok(nextCtrl, 'Next button must be detected on Step 1');
      assert.equal(nextCtrl.isExecutable, true);
      assert.equal(nextCtrl.isTerminal, false);
      assert.equal(state.terminalControlDetected, false);
    });

    test('approves and navigates from Step 1 to Step 2', async () => {
      const stateBefore = browserNavigationService.getNavigationState(sessionId);
      const nextCtrl = stateBefore.currentStep!.controls.find((c) => c.type === 'NEXT');
      assert.ok(nextCtrl);

      const navResult = await browserNavigationService.approveAndNavigate(sessionId, nextCtrl.id);

      assert.equal(navResult.success, true);
      assert.ok(navResult.previousStep);
      assert.equal(navResult.previousStep.stepIndex, 1);
      assert.equal(navResult.previousStep.completed, true);

      // Verify Step 2 current state
      assert.equal(navResult.currentStep.stepIndex, 2);
      assert.ok(navResult.currentStep.heading?.includes('Step 2'));

      // Verify state preservation
      assert.equal(navResult.navigationState.visitedSteps.length, 1);
      assert.equal(navResult.navigationState.visitedSteps[0].stepIndex, 1);
      assert.equal(navResult.navigationState.stepHistory.length, 1);
      assert.equal(navResult.navigationState.stepHistory[0].fromStepId, navResult.previousStep.stepId);
      assert.equal(navResult.navigationState.stepHistory[0].controlType, 'NEXT');

      // Verify Step 2 controls: Back and Continue
      const backCtrl = navResult.currentStep.controls.find((c) => c.type === 'BACK');
      const continueCtrl = navResult.currentStep.controls.find((c) => c.type === 'CONTINUE');
      assert.ok(backCtrl, 'Back button must be detected on Step 2');
      assert.ok(continueCtrl, 'Continue button must be detected on Step 2');
      assert.equal(backCtrl.direction, 'BACKWARD');
      assert.equal(continueCtrl.direction, 'FORWARD');
    });

    test('approves and navigates from Step 2 to Step 3', async () => {
      const stateBefore = browserNavigationService.getNavigationState(sessionId);
      const continueCtrl = stateBefore.currentStep!.controls.find((c) => c.type === 'CONTINUE');
      assert.ok(continueCtrl);

      const navResult = await browserNavigationService.approveAndNavigate(sessionId, continueCtrl.id);

      assert.equal(navResult.success, true);
      assert.equal(navResult.currentStep.stepIndex, 3);
      assert.ok(navResult.currentStep.heading?.includes('Step 3'));

      // Verify history contains Step 1 and Step 2
      assert.equal(navResult.navigationState.visitedSteps.length, 2);
      assert.equal(navResult.navigationState.stepHistory.length, 2);

      // Verify Step 3 controls: Review and Submit
      const reviewCtrl = navResult.currentStep.controls.find((c) => c.type === 'REVIEW');
      const submitCtrl = navResult.currentStep.controls.find((c) => c.type === 'TERMINAL');

      assert.ok(reviewCtrl, 'Review button must be detected on Step 3');
      assert.equal(reviewCtrl.isExecutable, true);

      assert.ok(submitCtrl, 'Terminal Submit button must be detected on Step 3');
      assert.equal(submitCtrl.isExecutable, false);
      assert.equal(submitCtrl.isTerminal, true);
      assert.equal(navResult.terminalControlDetected, true);
    });

    test('strictly rejects attempt to execute terminal control with TerminalActionForbiddenError', async () => {
      const state = browserNavigationService.getNavigationState(sessionId);
      const submitCtrl = state.currentStep!.controls.find((c) => c.type === 'TERMINAL');
      assert.ok(submitCtrl);

      await assert.rejects(
        async () => {
          await browserNavigationService.approveAndNavigate(sessionId, submitCtrl.id);
        },
        (err: unknown) => {
          assert.ok(err instanceof TerminalActionForbiddenError);
          assert.equal(err.code, 'TERMINAL_ACTION_FORBIDDEN');
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    });

    test('rejects non-existent controlId with NavigationControlNotFoundError', async () => {
      await assert.rejects(
        async () => {
          await browserNavigationService.approveAndNavigate(sessionId, 'ctrl-invalid-nonexistent');
        },
        (err: unknown) => {
          assert.ok(err instanceof NavigationControlNotFoundError);
          assert.equal(err.code, 'CONTROL_NOT_FOUND');
          assert.equal(err.statusCode, 404);
          return true;
        }
      );
    });

    test('confirms submission count remains strictly 0 after rejection', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/browser/test-page/multi-step/submission-status',
      });
      const data = JSON.parse(res.body);
      assert.equal(data.submissionCount, 0);
      assert.equal(data.applicationSubmitted, false);
    });
  });
});
