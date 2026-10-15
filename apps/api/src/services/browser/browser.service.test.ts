import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { BrowserService } from './browser.service.js';
import { validateBrowserUrl, clampTimeout } from './browser.config.js';
import {
  BrowserNotEnabledError,
  BrowserSessionNotFoundError,
  BrowserCapacityError,
  InvalidBrowserUrlError,
  BrowserNavigationTimeoutError,
} from './browser.errors.js';

describe('Browser Automation Foundation (Milestone 10.1 Service)', () => {
  let localServer: http.Server;
  let localServerUrl: string;
  let service: BrowserService;

  before(async () => {
    // Spin up lightweight local HTTP fixture server for deterministic, offline testing
    await new Promise<void>((resolve) => {
      localServer = http.createServer((req, res) => {
        if (req.url === '/slow') {
          // Intentionally delayed response for timeout testing
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><head><title>Slow Page</title></head><body>Delayed</body></html>');
          }, 5000);
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Deterministic Local Test</title></head>
<body>
  <h1>Local Test Page</h1>
  <form id="test-form" action="/submit" method="POST">
    <input type="text" name="name" value="Jane Doe" />
    <input type="email" name="email" value="jane@example.com" />
    <button type="submit" id="btn-submit">Submit</button>
  </form>
  <div class="nav-links">
    <a href="/one">Link 1</a>
    <a href="/two">Link 2</a>
    <a href="/three">Link 3</a>
  </div>
</body>
</html>`);
      });

      localServer.listen(0, '127.0.0.1', () => {
        const address = localServer.address();
        if (typeof address === 'object' && address) {
          localServerUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });

    service = new BrowserService({
      enabled: true,
      headless: true,
      maxContexts: 2,
      timeoutMs: 10000,
      navigationTimeoutMs: 10000,
    });
  });

  after(async () => {
    if (service) {
      await service.closeBrowser();
    }
    if (localServer) {
      await new Promise<void>((resolve) => localServer.close(() => resolve()));
    }
  });

  // A. URL Validation & Protocol Safeguards
  describe('URL Safety & Protocol Validation', () => {
    test('accepts valid http and https URLs', () => {
      const httpUrl = validateBrowserUrl('http://127.0.0.1:3000/test');
      assert.equal(httpUrl.protocol, 'http:');

      const httpsUrl = validateBrowserUrl('https://example.com/careers');
      assert.equal(httpsUrl.protocol, 'https:');
    });

    test('rejects javascript: scheme', () => {
      assert.throws(
        () => validateBrowserUrl('javascript:alert(1)'),
        (err: Error) => err instanceof InvalidBrowserUrlError && err.message.includes('javascript')
      );
    });

    test('rejects data: scheme', () => {
      assert.throws(
        () => validateBrowserUrl('data:text/html,<h1>Hello</h1>'),
        (err: Error) => err instanceof InvalidBrowserUrlError && err.message.includes('data')
      );
    });

    test('rejects file: scheme', () => {
      assert.throws(
        () => validateBrowserUrl('file:///etc/passwd'),
        (err: Error) => err instanceof InvalidBrowserUrlError && err.message.includes('file')
      );
    });

    test('rejects about: and chrome: schemes', () => {
      assert.throws(
        () => validateBrowserUrl('about:blank'),
        (err: Error) => err instanceof InvalidBrowserUrlError
      );
      assert.throws(
        () => validateBrowserUrl('chrome://settings'),
        (err: Error) => err instanceof InvalidBrowserUrlError
      );
    });

    test('rejects empty or excessively long URLs', () => {
      assert.throws(() => validateBrowserUrl(''), InvalidBrowserUrlError);
      const longUrl = 'https://example.com/' + 'a'.repeat(2500);
      assert.throws(() => validateBrowserUrl(longUrl), InvalidBrowserUrlError);
    });

    test('clamps requested timeouts safely', () => {
      assert.equal(clampTimeout(undefined, 30000), 30000);
      assert.equal(clampTimeout(500, 30000, 1000, 120000), 1000);
      assert.equal(clampTimeout(500000, 30000, 1000, 120000), 120000);
      assert.equal(clampTimeout(15000, 30000, 1000, 120000), 15000);
    });
  });

  // B. Lifecycle & Context Isolation
  describe('Session Lifecycle & Context Isolation', () => {
    let sessionAId: string;
    let sessionBId: string;

    test('creates isolated session with initial IDLE status', async () => {
      const session = await service.createSession();
      assert.ok(session.sessionId);
      assert.equal(session.status, 'IDLE');
      sessionAId = session.sessionId;

      const details = service.getSession(sessionAId);
      assert.equal(details.sessionId, sessionAId);
      assert.equal(details.currentUrl, null);
      assert.equal(details.title, null);
    });

    test('creates second session independently (isolated context)', async () => {
      const session = await service.createSession();
      assert.ok(session.sessionId);
      assert.notEqual(session.sessionId, sessionAId);
      sessionBId = session.sessionId;
      assert.equal(service.getActiveSessionCount(), 2);
    });

    test('enforces session concurrency capacity limit', async () => {
      await assert.rejects(
        async () => service.createSession(),
        (err: Error) => err instanceof BrowserCapacityError && (err as any).statusCode === 429
      );
    });

    test('navigates to local test page and collects page metadata', async () => {
      const result = await service.navigate(sessionAId, localServerUrl);
      assert.equal(result.sessionId, sessionAId);
      assert.ok(result.url.startsWith('http://127.0.0.1'));
      assert.equal(result.title, 'Deterministic Local Test');
      assert.equal(result.status, 200);
      assert.ok(result.contentType?.includes('text/html'));

      const updated = service.getSession(sessionAId);
      assert.equal(updated.status, 'ACTIVE');
      assert.equal(updated.title, 'Deterministic Local Test');
    });

    test('inspects basic structural elements without form interaction', async () => {
      const inspection = await service.inspectPage(sessionAId);
      assert.equal(inspection.title, 'Deterministic Local Test');
      assert.equal(inspection.forms, 1);
      assert.equal(inspection.inputs, 2);
      assert.equal(inspection.buttons, 1);
      assert.equal(inspection.links, 3);
    });

    test('captures screenshot to controlled directory without path traversal', async () => {
      const screenshot = await service.takeScreenshot(sessionAId);
      assert.equal(screenshot.sessionId, sessionAId);
      assert.ok(screenshot.screenshotId);
      assert.ok(screenshot.path.endsWith('.png'));

      // Verify file exists on disk and clean up
      await assert.doesNotReject(async () => {
        await fs.access(screenshot.path);
        await fs.unlink(screenshot.path);
      });
    });

    test('handles navigation timeout safely without crashing browser', async () => {
      await assert.rejects(
        async () => service.navigate(sessionAId, `${localServerUrl}/slow`, 1000),
        (err: Error) =>
          err instanceof BrowserNavigationTimeoutError && (err as any).statusCode === 504
      );
    });

    test('closes session and cleans up resources', async () => {
      const closeResult = await service.closeSession(sessionAId);
      assert.equal(closeResult.success, true);
      assert.equal(closeResult.sessionId, sessionAId);

      // Subsequent access throws not found
      assert.throws(
        () => service.getSession(sessionAId),
        (err: Error) => err instanceof BrowserSessionNotFoundError
      );

      // Clean up second session
      await service.closeSession(sessionBId);
      assert.equal(service.getActiveSessionCount(), 0);
    });
  });

  // C. Browser Disabled Configuration Guard
  describe('Browser Disabled Safeguard', () => {
    test('throws BrowserNotEnabledError when browser automation is disabled', async () => {
      const disabledService = new BrowserService({ enabled: false });

      await assert.rejects(
        async () => disabledService.createSession(),
        (err: Error) => err instanceof BrowserNotEnabledError && (err as any).statusCode === 403
      );
    });
  });
});
