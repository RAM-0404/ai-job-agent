import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { browserService } from '../services/browser/browser.service.js';

describe('Browser Multi-Step Navigation Routes (Milestone 12.1 API)', () => {
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

    // Create session via route
    const sessionRes = await app.inject({
      method: 'POST',
      url: '/browser/sessions',
    });
    const sessionBody = JSON.parse(sessionRes.body);
    sessionId = sessionBody.sessionId;
  });

  after(async () => {
    if (sessionId) {
      await app.inject({
        method: 'DELETE',
        url: `/browser/sessions/${sessionId}`,
      });
    }
    await browserService.closeBrowser();
    await app.close();
  });

  test('GET /browser/test-page/multi-step returns deterministic multi-step fixture', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/browser/test-page/multi-step',
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.includes('text/html'));
    assert.ok(res.body.includes('Senior Cloud Architect Application'));
    assert.ok(res.body.includes('id="step-1"'));
    assert.ok(res.body.includes('id="next-btn-step1"'));
  });

  test('POST /browser/sessions/:id/navigation/discover navigates and discovers Step 1', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/navigation/discover`,
      payload: {
        targetUrl: multiStepUrl,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.sessionId, sessionId);
    assert.equal(body.status, 'WAITING_FOR_APPROVAL');
    assert.ok(body.currentStep);
    assert.equal(body.currentStep.stepIndex, 1);
    assert.equal(body.currentStep.discoveredFieldCount, 3);

    const nextCtrl = body.currentStep.controls.find((c: any) => c.type === 'NEXT');
    assert.ok(nextCtrl);
    assert.equal(nextCtrl.isExecutable, true);
    assert.equal(nextCtrl.isTerminal, false);
  });

  test('GET /browser/sessions/:id/navigation returns active navigation state', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/navigation`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.sessionId, sessionId);
    assert.equal(body.currentStep.stepIndex, 1);
  });

  test('POST /browser/sessions/:id/navigation/approve rejects missing controlId with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/navigation/approve`,
      payload: {},
    });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Bad Request');
  });

  test('POST /browser/sessions/:id/navigation/approve rejects unknown control with 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/navigation/approve`,
      payload: {
        controlId: 'ctrl-unknown-invalid',
      },
    });

    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.code, 'CONTROL_NOT_FOUND');
  });

  test('POST /browser/sessions/:id/navigation/approve advances from Step 1 to Step 2', async () => {
    // 1. Get current controls
    const stateRes = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/navigation`,
    });
    const state = JSON.parse(stateRes.body);
    const nextCtrl = state.currentStep.controls.find((c: any) => c.type === 'NEXT');
    assert.ok(nextCtrl);

    // 2. Approve Next
    const approveRes = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/navigation/approve`,
      payload: {
        controlId: nextCtrl.id,
      },
    });

    assert.equal(approveRes.statusCode, 200);
    const approveBody = JSON.parse(approveRes.body);
    assert.equal(approveBody.success, true);
    assert.equal(approveBody.previousStep.stepIndex, 1);
    assert.equal(approveBody.previousStep.completed, true);
    assert.equal(approveBody.currentStep.stepIndex, 2);

    // Verify history preserved
    assert.equal(approveBody.navigationState.visitedSteps.length, 1);
    assert.equal(approveBody.navigationState.stepHistory.length, 1);
  });

  test('POST /browser/sessions/:id/navigation/approve advances from Step 2 to Step 3', async () => {
    // 1. Get current controls
    const stateRes = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/navigation`,
    });
    const state = JSON.parse(stateRes.body);
    const continueCtrl = state.currentStep.controls.find((c: any) => c.type === 'CONTINUE');
    assert.ok(continueCtrl);

    // 2. Approve Continue
    const approveRes = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/navigation/approve`,
      payload: {
        controlId: continueCtrl.id,
      },
    });

    assert.equal(approveRes.statusCode, 200);
    const approveBody = JSON.parse(approveRes.body);
    assert.equal(approveBody.success, true);
    assert.equal(approveBody.currentStep.stepIndex, 3);
    assert.equal(approveBody.terminalControlDetected, true);
  });

  test('POST /browser/sessions/:id/navigation/approve strictly forbids terminal control execution with 403', async () => {
    const stateRes = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/navigation`,
    });
    const state = JSON.parse(stateRes.body);
    const submitCtrl = state.currentStep.controls.find((c: any) => c.type === 'TERMINAL');
    assert.ok(submitCtrl, 'Submit control must exist on Step 3');

    const approveRes = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/navigation/approve`,
      payload: {
        controlId: submitCtrl.id,
      },
    });

    assert.equal(approveRes.statusCode, 403);
    const errBody = JSON.parse(approveRes.body);
    assert.equal(errBody.error, 'Forbidden');
    assert.equal(errBody.code, 'TERMINAL_ACTION_FORBIDDEN');
    assert.ok(errBody.message.includes('strictly forbidden'));
  });

  test('GET /browser/test-page/multi-step/submission-status proves submissionCount is strictly 0', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/browser/test-page/multi-step/submission-status',
    });

    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.submissionCount, 0);
    assert.equal(data.applicationSubmitted, false);
  });

  test('DELETE /browser/sessions/:id/navigation clears in-memory navigation state', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/browser/sessions/${sessionId}/navigation`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);

    // Subsequent GET returns 400 (no active state initialized)
    const getRes = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/navigation`,
    });
    assert.equal(getRes.statusCode, 400);
  });
});
