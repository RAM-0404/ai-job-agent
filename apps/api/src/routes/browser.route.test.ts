import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import { buildServer } from '../server.js';
import { browserService } from '../services/browser/browser.service.js';

describe('Browser Automation Routes (Milestone 10.1 API)', () => {
  let app: FastifyInstance;
  let serverPort: number;
  let localPageUrl: string;
  let createdSessionId: string;

  before(async () => {
    app = await buildServer();
    // Listen on ephemeral local port so Playwright can navigate to it over HTTP
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const match = address.match(/:(\d+)$/);
    serverPort = match ? Number(match[1]) : 3000;
    localPageUrl = `http://127.0.0.1:${serverPort}/browser/test-page`;
  });

  after(async () => {
    await browserService.closeBrowser();
    await app.close();
  });

  test('GET /browser/test-page returns deterministic HTML test fixture', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/browser/test-page',
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.includes('text/html'));
    assert.ok(res.body.includes('Deterministic Browser Fixture'));
    assert.ok(res.body.includes('id="sample-form"'));
  });

  test('POST /browser/sessions creates a new browser session in IDLE state', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/browser/sessions',
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.ok(body.sessionId);
    assert.equal(body.status, 'IDLE');
    assert.ok(body.createdAt);

    createdSessionId = body.sessionId;
  });

  test('GET /browser/sessions/:id returns session details', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${createdSessionId}`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.sessionId, createdSessionId);
    assert.equal(body.status, 'IDLE');
    assert.equal(body.currentUrl, null);
  });

  test('POST /browser/sessions/:id/navigate rejects unsafe javascript: protocol with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${createdSessionId}/navigate`,
      payload: {
        url: 'javascript:alert(1)',
      },
    });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Bad Request');
    assert.ok(body.message.includes('Protocol "javascript:" is not permitted'));
  });

  test('POST /browser/sessions/:id/navigate rejects local file: protocol with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${createdSessionId}/navigate`,
      payload: {
        url: 'file:///etc/hosts',
      },
    });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Bad Request');
  });

  test('POST /browser/sessions/:id/navigate succeeds with local HTTP test fixture', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${createdSessionId}/navigate`,
      payload: {
        url: localPageUrl,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.sessionId, createdSessionId);
    assert.equal(body.url, localPageUrl);
    assert.equal(body.title, 'Browser Test Fixture');
    assert.equal(body.status, 200);
  });

  test('GET /browser/sessions/:id/inspect returns page structure diagnostic counts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${createdSessionId}/inspect`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.title, 'Browser Test Fixture');
    assert.equal(body.forms, 1);
    assert.equal(body.inputs, 2);
    assert.equal(body.buttons, 1);
    assert.equal(body.links, 3);
  });

  test('POST /browser/sessions/:id/screenshot captures and returns screenshot path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${createdSessionId}/screenshot`,
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.sessionId, createdSessionId);
    assert.ok(body.screenshotId);
    assert.ok(body.path.endsWith('.png'));

    // Verify screenshot file exists on disk and clean it up
    await assert.doesNotReject(async () => {
      await fs.access(body.path);
      await fs.unlink(body.path);
    });
  });

  test('POST /browser/sessions/:id/application-discovery inspects current page structure', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${createdSessionId}/application-discovery`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.sessionId, createdSessionId);
    assert.ok(body.application);
    assert.ok(Array.isArray(body.forms));
    assert.ok(Array.isArray(body.fields));
    assert.ok(Array.isArray(body.buttons));
    assert.ok(Array.isArray(body.candidateMappings));
    assert.ok(Array.isArray(body.missingInformation));
  });

  test('POST /browser/sessions/:id/application-discovery navigates to URL and discovers targets', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${createdSessionId}/application-discovery`,
      payload: {
        url: `http://127.0.0.1:${serverPort}/browser/test-page/job-description`,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.targets.length >= 1);
    assert.equal(body.targets[0].type, 'APPLICATION_LINK');
  });

  test('POST /browser/sessions/:id/application-discovery rejects unsafe protocol with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${createdSessionId}/application-discovery`,
      payload: {
        url: 'javascript:alert(1)',
      },
    });

    assert.equal(res.statusCode, 400);
  });

  test('POST /browser/sessions/:id/application-discovery returns 404 for unknown session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/browser/sessions/00000000-0000-0000-0000-000000000000/application-discovery',
    });

    assert.equal(res.statusCode, 404);
  });

  test('GET /browser/test-page/autofill returns deterministic M11 autofill fixture', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/browser/test-page/autofill',
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('Senior Systems Engineer Application'));
    assert.ok(res.body.includes('id="autofill-app-form"'));
  });

  test('POST /browser/sessions/:id/autofill/proposal generates unapproved proposal for session', async () => {
    // Navigate to autofill fixture first
    await app.inject({
      method: 'POST',
      url: `/browser/sessions/${createdSessionId}/navigate`,
      payload: {
        url: `http://127.0.0.1:${serverPort}/browser/test-page/autofill`,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${createdSessionId}/autofill/proposal`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.sessionId, createdSessionId);
    assert.equal(body.state, 'WAITING_FOR_APPROVAL');
    assert.ok(body.proposals.length > 0);
    for (const prop of body.proposals) {
      assert.equal(prop.approved, false, 'Field proposal must begin unapproved');
    }
  });

  test('GET /browser/sessions/:id/autofill/proposal returns current proposal', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${createdSessionId}/autofill/proposal`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.sessionId, createdSessionId);
  });

  test('POST /browser/sessions/:id/autofill/approve executes mutation on selected fields only', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${createdSessionId}/autofill/approve`,
      payload: {
        fieldIds: ['fullName', 'email'],
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.applicationSubmitted, false, 'Must NEVER submit application');
    assert.ok(body.results.length >= 2);

    const nameRes = body.results.find((r: any) => r.fieldId === 'fullName');
    assert.ok(nameRes);
    assert.equal(nameRes.status, 'SUCCESS');

    const emailRes = body.results.find((r: any) => r.fieldId === 'email');
    assert.ok(emailRes);
    assert.equal(emailRes.status, 'SUCCESS');
  });

  test('POST /browser/sessions/:id/autofill/verify re-checks validation state without submitting', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/browser/sessions/${createdSessionId}/autofill/verify`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.applicationSubmitted, false);
  });

  test('GET /browser/test-page/autofill/submission-status confirms zero submissions occurred', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/browser/test-page/autofill/submission-status',
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.applicationSubmitted, false, 'No form submissions must have occurred');
    assert.equal(body.submissionCount, 0, 'Submission count must be strictly 0');
  });

  test('DELETE /browser/sessions/:id/autofill clears autofill state', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/browser/sessions/${createdSessionId}/autofill`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
  });

  test('DELETE /browser/sessions/:id releases session resources', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/browser/sessions/${createdSessionId}`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.sessionId, createdSessionId);
  });

  test('GET /browser/sessions/:id returns 404 after session has been deleted', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/browser/sessions/${createdSessionId}`,
    });

    assert.equal(res.statusCode, 404);
  });

  test('GET /browser/sessions/unknown returns 404 for non-existent session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/browser/sessions/00000000-0000-0000-0000-000000000000',
    });

    assert.equal(res.statusCode, 404);
  });
});
