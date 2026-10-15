import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { browserService } from '../services/browser/browser.service.js';

describe('Browser Multi-Step Workflow Routes (Milestone 12.2 API)', () => {
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
    }
    await browserService.closeBrowser();
    await app.close();
  });

  test('POST /browser/sessions/:id/workflow/init initializes workflow on Step 1', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/init`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.sessionId, sessionId);
    assert.equal(body.currentStepIndex, 1);
    assert.ok(body.currentStepHeading?.includes('Step 1'));
    assert.equal(body.discoveredFields.length, 3);
    assert.equal(body.applicationSubmitted, false);

    // Proposals must all start unapproved
    for (const prop of body.currentProposals) {
      assert.equal(prop.approved, false);
    }
  });

  test('GET /browser/sessions/:id/workflow/state retrieves active workflow state', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/workflow/state`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.sessionId, sessionId);
    assert.equal(body.currentStepIndex, 1);
  });

  test('POST /browser/sessions/:id/workflow/step/execute rejects missing approvedFieldIds with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/step/execute`,
      payload: {},
    });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Bad Request');
  });

  test('POST /browser/sessions/:id/workflow/step/execute populates approved fields on Step 1', async () => {
    const stateRes = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/workflow/state`,
    });
    const state = JSON.parse(stateRes.body);
    const fullNameProp = state.currentProposals.find((p: any) => p.fieldName === 'fullName');
    const emailProp = state.currentProposals.find((p: any) => p.fieldName === 'email');

    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/step/execute`,
      payload: {
        approvedFieldIds: [fullNameProp.fieldId, emailProp.fieldId],
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.stepIndex, 1);
    assert.equal(body.applicationSubmitted, false);
    assert.equal(body.canNavigateForward, true);

    const filledResults = body.results.filter((r: any) => r.status === 'SUCCESS' && r.verified);
    assert.equal(filledResults.length, 2);
  });

  test('POST /browser/sessions/:id/workflow/step/navigate explicitly advances to Step 2', async () => {
    const stateRes = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/workflow/state`,
    });
    const state = JSON.parse(stateRes.body);
    const nextCtrl = state.availableNavigationControls.find((c: any) => c.direction === 'FORWARD');
    assert.ok(nextCtrl);

    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/step/navigate`,
      payload: {
        controlId: nextCtrl.id,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.previousStepIndex, 1);
    assert.equal(body.currentStepIndex, 2);
    assert.ok(body.newHeading?.includes('Step 2'));
    assert.equal(body.rediscoveredFieldCount, 3); // experienceYears, location, workMode
    assert.equal(body.applicationSubmitted, false);

    // New proposals must all require fresh approval
    for (const prop of body.newProposals) {
      assert.equal(prop.approved, false);
    }
  });

  test('POST /browser/sessions/:id/workflow/step/execute populates approved fields on Step 2', async () => {
    const stateRes = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/workflow/state`,
    });
    const state = JSON.parse(stateRes.body);
    const locProp = state.currentProposals.find((p: any) => p.fieldName === 'location');

    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/step/execute`,
      payload: {
        approvedFieldIds: locProp ? [locProp.fieldId] : [],
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.stepIndex, 2);
  });

  test('POST /browser/sessions/:id/workflow/step/navigate advances to Step 3', async () => {
    const stateRes = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/workflow/state`,
    });
    const state = JSON.parse(stateRes.body);
    const continueCtrl = state.availableNavigationControls.find((c: any) => c.direction === 'FORWARD');
    assert.ok(continueCtrl);

    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/step/navigate`,
      payload: {
        controlId: continueCtrl.id,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.currentStepIndex, 3);
    assert.ok(body.newHeading?.includes('Step 3'));
    assert.equal(body.terminalControlDetected, true);
    assert.equal(body.applicationSubmitted, false);
  });

  test('POST /browser/sessions/:id/workflow/step/navigate strictly forbids terminal control execution with 403', async () => {
    const stateRes = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/workflow/state`,
    });
    const state = JSON.parse(stateRes.body);
    const submitCtrl = state.availableNavigationControls.find((c: any) => c.isTerminal);
    assert.ok(submitCtrl);

    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${sessionId}/workflow/step/navigate`,
      payload: {
        controlId: submitCtrl.id,
      },
    });

    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Forbidden');
    assert.equal(body.code, 'TERMINAL_ACTION_FORBIDDEN');
    assert.ok(body.message.includes('strictly forbidden'));
  });

  test('GET /browser/sessions/:id/workflow/history returns cumulative history across all completed steps', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/workflow/history`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.sessionId, sessionId);
    assert.equal(body.applicationSubmitted, false);
    assert.equal(body.stepHistory.length, 3);
    assert.equal(body.totalStepsCompleted, 2);
  });

  test('GET /browser/test-page/multi-step/submission-status proves submissionCount is strictly 0', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/browser/test-page/multi-step/submission-status',
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.submissionCount, 0);
    assert.equal(body.applicationSubmitted, false);
  });

  test('DELETE /browser/sessions/:id/workflow clears workflow state', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/browser/sessions/${sessionId}/workflow`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);

    // Verify getting state now returns 500/error
    const getRes = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${sessionId}/workflow/state`,
    });
    assert.equal(getRes.statusCode, 500);
  });
});
