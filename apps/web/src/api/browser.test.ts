import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBrowserSession,
  getBrowserSession,
  discoverApplicationPage,
  captureBrowserScreenshot,
  closeBrowserSession,
} from './browser.js';
import { ApiError } from './client.js';

describe('Browser API Client (Milestone 10.3 Frontend Client)', () => {
  const originalFetch = globalThis.fetch;

  after(() => {
    globalThis.fetch = originalFetch;
  });

  test('createBrowserSession sends POST to /browser/sessions and returns session data', async () => {
    const mockResponse = {
      sessionId: 'sess-123',
      status: 'IDLE',
      createdAt: '2026-10-06T12:00:00Z',
    };

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), 'http://localhost:3000/browser/sessions');
      assert.equal(init?.method, 'POST');
      return new Response(JSON.stringify(mockResponse), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await createBrowserSession();
    assert.equal(res.sessionId, 'sess-123');
    assert.equal(res.status, 'IDLE');
  });

  test('getBrowserSession sends GET to /browser/sessions/:id', async () => {
    const mockSession = {
      sessionId: 'sess-123',
      status: 'ACTIVE',
      currentUrl: 'https://example.com/apply',
      title: 'Job Application',
      createdAt: '2026-10-06T12:00:00Z',
      lastActivityAt: '2026-10-06T12:01:00Z',
    };

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), 'http://localhost:3000/browser/sessions/sess-123');
      assert.equal(init?.method, 'GET');
      return new Response(JSON.stringify(mockSession), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await getBrowserSession('sess-123');
    assert.equal(res.sessionId, 'sess-123');
    assert.equal(res.status, 'ACTIVE');
  });

  test('discoverApplicationPage sends POST to /browser/sessions/:id/application-discovery with payload', async () => {
    const mockDiscovery = {
      sessionId: 'sess-123',
      page: { url: 'https://example.com/apply', title: 'Apply', status: 200 },
      application: {
        isApplicationPage: true,
        confidence: 0.95,
        signals: ['Form detected', 'Resume field detected'],
      },
      targets: [],
      forms: [{ index: 0, id: 'form1', name: null, action: '/submit', method: 'POST', ariaLabel: null, surroundingHeading: null, fieldCount: 3, requiredFieldCount: 2, buttonCount: 1 }],
      fields: [
        { index: 0, formIndex: 0, tag: 'input', type: 'TEXT', name: 'name', id: 'name', placeholder: null, autocomplete: null, ariaLabel: null, required: true, requirementSource: 'required', disabled: false, readOnly: false, hasValue: false, label: 'Name', labelSource: 'label', helpText: null },
      ],
      buttons: [],
      candidateMappings: [
        { fieldId: 'name', fieldName: 'name', label: 'Name', candidateSource: 'profile.fullName', confidence: 0.98, reason: 'Name matches', available: true },
      ],
      missingInformation: [],
    };

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), 'http://localhost:3000/browser/sessions/sess-123/application-discovery');
      assert.equal(init?.method, 'POST');
      assert.ok(init?.body);
      const parsedBody = JSON.parse(init.body as string);
      assert.equal(parsedBody.url, 'https://example.com/apply');

      return new Response(JSON.stringify(mockDiscovery), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await discoverApplicationPage('sess-123', { url: 'https://example.com/apply' });
    assert.equal(res.application.isApplicationPage, true);
    assert.equal(res.application.confidence, 0.95);
    assert.equal(res.fields.length, 1);
    assert.equal(res.candidateMappings.length, 1);
  });

  test('captureBrowserScreenshot sends POST to /browser/sessions/:id/screenshot', async () => {
    const mockScreenshot = {
      sessionId: 'sess-123',
      screenshotId: 'shot-abc',
      path: 'storage/browser/screenshots/sess-123-shot-abc.png',
      createdAt: '2026-10-06T12:05:00Z',
    };

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), 'http://localhost:3000/browser/sessions/sess-123/screenshot');
      assert.equal(init?.method, 'POST');
      return new Response(JSON.stringify(mockScreenshot), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await captureBrowserScreenshot('sess-123');
    assert.equal(res.screenshotId, 'shot-abc');
    assert.equal(res.path, 'storage/browser/screenshots/sess-123-shot-abc.png');
  });

  test('closeBrowserSession sends DELETE to /browser/sessions/:id', async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), 'http://localhost:3000/browser/sessions/sess-123');
      assert.equal(init?.method, 'DELETE');
      return new Response(JSON.stringify({ success: true, sessionId: 'sess-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await closeBrowserSession('sess-123');
    assert.equal(res.success, true);
    assert.equal(res.sessionId, 'sess-123');
  });

  test('handles 400 bad request error with ApiError', async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid URL for browser navigation: Protocol "javascript:" is not permitted.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    await assert.rejects(
      async () => {
        await discoverApplicationPage('sess-123', { url: 'javascript:alert(1)' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal((err as ApiError).status, 400);
        assert.ok((err as ApiError).message.includes('javascript:'));
        return true;
      }
    );
  });

  test('createAutofillProposal sends POST to /browser/sessions/:id/autofill/proposal', async () => {
    const mockProposal = {
      sessionId: 'sess-123',
      state: 'WAITING_FOR_APPROVAL',
      createdAt: '2026-10-06T12:00:00Z',
      proposals: [
        {
          fieldId: 'email',
          fieldName: 'email',
          fieldType: 'EMAIL',
          tag: 'input',
          label: 'Email',
          candidateSource: 'profile.email',
          proposedValue: 'alex@example.local',
          displayValue: 'alex@example.local',
          confidence: 0.99,
          approved: false,
          reason: 'Direct match',
        },
      ],
      totalFieldsCount: 5,
      mappableFieldsCount: 1,
      missingFieldsCount: 2,
      forbiddenFieldsCount: 2,
    };

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), 'http://localhost:3000/browser/sessions/sess-123/autofill/proposal');
      assert.equal(init?.method, 'POST');
      return new Response(JSON.stringify(mockProposal), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await (await import('./browser.js')).createAutofillProposal('sess-123');
    assert.equal(res.state, 'WAITING_FOR_APPROVAL');
    assert.equal(res.proposals.length, 1);
    assert.equal(res.proposals[0].approved, false);
  });

  test('approveAutofill sends POST to /browser/sessions/:id/autofill/approve with explicit fieldIds', async () => {
    const mockResult = {
      sessionId: 'sess-123',
      state: 'COMPLETED',
      completedAt: '2026-10-06T12:05:00Z',
      results: [
        {
          fieldId: 'email',
          fieldName: 'email',
          fieldType: 'EMAIL',
          status: 'SUCCESS',
          reason: 'Verified',
          verified: true,
          verifiedValue: 'alex@example.local',
        },
      ],
      validation: { valid: true, errors: [] },
      applicationSubmitted: false,
    };

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), 'http://localhost:3000/browser/sessions/sess-123/autofill/approve');
      assert.equal(init?.method, 'POST');
      const body = JSON.parse(init?.body as string);
      assert.deepEqual(body.fieldIds, ['email']);
      return new Response(JSON.stringify(mockResult), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await (await import('./browser.js')).approveAutofill('sess-123', ['email']);
    assert.equal(res.state, 'COMPLETED');
    assert.equal(res.applicationSubmitted, false);
    assert.equal(res.results[0].status, 'SUCCESS');
  });

  test('verifyAutofill sends POST to /browser/sessions/:id/autofill/verify', async () => {
    const mockResult = {
      sessionId: 'sess-123',
      state: 'COMPLETED',
      completedAt: '2026-10-06T12:06:00Z',
      results: [],
      validation: { valid: true, errors: [] },
      applicationSubmitted: false,
    };

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), 'http://localhost:3000/browser/sessions/sess-123/autofill/verify');
      assert.equal(init?.method, 'POST');
      return new Response(JSON.stringify(mockResult), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await (await import('./browser.js')).verifyAutofill('sess-123');
    assert.equal(res.applicationSubmitted, false);
  });

  test('clearAutofill sends DELETE to /browser/sessions/:id/autofill', async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), 'http://localhost:3000/browser/sessions/sess-123/autofill');
      assert.equal(init?.method, 'DELETE');
      return new Response(JSON.stringify({ success: true, sessionId: 'sess-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const res = await (await import('./browser.js')).clearAutofill('sess-123');
    assert.equal(res.success, true);
  });
});

