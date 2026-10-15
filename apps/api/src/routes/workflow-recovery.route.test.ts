import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { browserService } from '../services/browser/browser.service.js';
import { workflowPersistenceService } from '../services/browser/workflow-persistence.service.js';

describe('Workflow Recovery & Idempotency Routes (Milestone 12.3 API)', () => {
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

    // Navigate to multi-step fixture
    await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/navigate`,
      payload: { url: multiStepUrl },
    });
  });

  after(async () => {
    if (sessionId) {
      await app.inject({
        method: 'DELETE',
        url: `/browser/sessions/${sessionId}`,
      });
      await workflowPersistenceService.deleteWorkflowState(sessionId);
    }
    await browserService.closeBrowser();
    await app.close();
  });

  test('POST /browser/sessions/:id/workflow/init with x-idempotency-key records operation and state', async () => {
    const initRes = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/init`,
      headers: {
        'x-idempotency-key': 'init-key-1',
      },
    });

    assert.equal(initRes.statusCode, 200);
    const body = JSON.parse(initRes.body);
    assert.equal(body.sessionId, sessionId);
    assert.equal(body.currentStepIndex, 1);
    assert.equal(body.version, 1);

    // Verify operation record is inspectable via GET /operations/:key
    const opRes = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/workflow/operations/init-key-1`,
    });
    assert.equal(opRes.statusCode, 200);
    const opBody = JSON.parse(opRes.body);
    assert.equal(opBody.idempotencyKey, 'init-key-1');
    assert.equal(opBody.status, 'SUCCEEDED');
    assert.equal(opBody.operationType, 'INIT');
  });

  test('POST /browser/sessions/:id/workflow/init with same key returns cached result', async () => {
    const duplicateRes = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/init`,
      headers: {
        'x-idempotency-key': 'init-key-1',
      },
    });

    assert.equal(duplicateRes.statusCode, 200);
    const body = JSON.parse(duplicateRes.body);
    assert.equal(body.sessionId, sessionId);
  });

  test('POST /browser/sessions/:id/workflow/init rejects reused key with different payload with 409 Conflict', async () => {
    const conflictRes = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/init`,
      headers: {
        'x-idempotency-key': 'init-key-1',
      },
      payload: {
        userProfileId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      },
    });

    assert.equal(conflictRes.statusCode, 409);
    const errBody = JSON.parse(conflictRes.body);
    assert.equal(errBody.error, 'Conflict');
  });

  test('POST /browser/sessions/:id/workflow/recover reconciles live session with DOM', async () => {
    const recRes = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/recover`,
    });

    assert.equal(recRes.statusCode, 200);
    const body = JSON.parse(recRes.body);
    assert.equal(body.success, true);
    assert.equal(body.recoveryStatus, 'RECOVERED');
    assert.equal(body.reason, 'RECONCILED');
    assert.equal(body.browserSessionAvailable, true);
    assert.equal(body.domMatchesSnapshot, true);
    assert.equal(body.canResume, true);
  });

  test('GET /browser/sessions/:id/workflow/operations lists all session operations', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/workflow/operations`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.sessionId, sessionId);
    assert.ok(Array.isArray(body.operations));
    assert.ok(body.operations.length >= 1);
  });

  test('POST /browser/sessions/:id/workflow/step/execute enforces idempotency and persists execution', async () => {
    const execRes1 = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/step/execute`,
      headers: {
        'x-idempotency-key': 'exec-step-1',
      },
      payload: {
        approvedFieldIds: ['firstName'],
      },
    });

    assert.equal(execRes1.statusCode, 200);
    const body1 = JSON.parse(execRes1.body);
    assert.equal(body1.success, true);

    // Duplicate call with same key returns cached result
    const execRes2 = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/step/execute`,
      headers: {
        'x-idempotency-key': 'exec-step-1',
      },
      payload: {
        approvedFieldIds: ['firstName'],
      },
    });

    assert.equal(execRes2.statusCode, 200);
    const body2 = JSON.parse(execRes2.body);
    assert.deepEqual(body1, body2);
  });

  test('Terminal control execution remains strictly forbidden with HTTP 403', async () => {
    // 1. Step 1 -> Step 2
    const stateRes1 = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/workflow/state`,
    });
    const state1 = JSON.parse(stateRes1.body);
    const nextCtrl1 = state1.availableNavigationControls.find((c: any) => c.direction === 'FORWARD' && !c.isTerminal);
    assert.ok(nextCtrl1);

    await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/step/navigate`,
      payload: { controlId: nextCtrl1.id },
    });

    // 2. Step 2 -> Step 3
    const stateRes2 = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/workflow/state`,
    });
    const state2 = JSON.parse(stateRes2.body);
    const nextCtrl2 = state2.availableNavigationControls.find((c: any) => c.direction === 'FORWARD' && !c.isTerminal);
    assert.ok(nextCtrl2);

    await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/step/navigate`,
      payload: { controlId: nextCtrl2.id },
    });

    // 3. Step 3 reached - find terminal Submit button
    const stateRes3 = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/workflow/state`,
    });
    const state3 = JSON.parse(stateRes3.body);
    const submitCtrl = state3.availableNavigationControls.find((c: any) => c.isTerminal);
    assert.ok(submitCtrl);

    // Attempt to execute terminal Submit control
    const submitRes = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/step/navigate`,
      payload: { controlId: submitCtrl.id },
    });

    assert.equal(submitRes.statusCode, 403);
    const errBody = JSON.parse(submitRes.body);
    assert.equal(errBody.error, 'Forbidden');
    assert.equal(errBody.code, 'TERMINAL_ACTION_FORBIDDEN');
  });

  test('Recovery detects lost session context after session deletion', async () => {
    // Close browser session directly without clearing workflow persistence (simulating API restart / crash)
    await browserService.closeSession(sessionId);

    // Attempt recovery on the persisted state with lost browser context
    const recRes = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/recover`,
    });

    assert.equal(recRes.statusCode, 200);
    const body = JSON.parse(recRes.body);
    assert.equal(body.success, false);
    assert.equal(body.recoveryStatus, 'REQUIRES_INTERVENTION');
    assert.equal(body.reason, 'BROWSER_SESSION_LOST');
    assert.equal(body.browserSessionAvailable, false);
    assert.equal(body.canResume, false);
  });
});
