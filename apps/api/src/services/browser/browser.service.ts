import { chromium, type Browser } from 'playwright';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  getBrowserConfig,
  validateBrowserUrl,
  clampTimeout,
  type BrowserServiceConfig,
} from './browser.config.js';
import {
  BrowserNotEnabledError,
  BrowserLaunchError,
  BrowserSessionNotFoundError,
  BrowserNavigationError,
  BrowserNavigationTimeoutError,
  BrowserCapacityError,
  BrowserOperationError,
} from './browser.errors.js';
import type {
  InternalBrowserSession,
  PageMetadata,
  PageInspection,
  ScreenshotResult,
} from './browser.types.js';
import type {
  BrowserSessionDto,
  CreateBrowserSessionResponse,
  CloseBrowserSessionResponse,
} from '@ai-job-agent/shared';

export class BrowserService {
  private browser: Browser | null = null;
  private readonly sessions = new Map<string, InternalBrowserSession>();
  private readonly config: BrowserServiceConfig;

  constructor(customConfig?: Partial<BrowserServiceConfig>) {
    this.config = {
      ...getBrowserConfig(),
      ...(customConfig || {}),
    };
  }

  /**
   * Lazily launches the shared Playwright Chromium browser instance if enabled.
   */
  async launchBrowser(): Promise<Browser> {
    if (!this.config.enabled) {
      throw new BrowserNotEnabledError();
    }

    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    try {
      this.browser = await chromium.launch({
        headless: this.config.headless,
        timeout: this.config.timeoutMs,
      });
      return this.browser;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserLaunchError(`Failed to launch Playwright browser: ${message}`);
    }
  }

  /**
   * Creates an isolated browser session with its own context and initial page.
   * Concurrency is clamped by maxContexts to prevent memory/CPU exhaustion.
   */
  async createSession(): Promise<CreateBrowserSessionResponse> {
    if (!this.config.enabled) {
      throw new BrowserNotEnabledError();
    }

    if (this.sessions.size >= this.config.maxContexts) {
      throw new BrowserCapacityError(this.config.maxContexts);
    }

    const browser = await this.launchBrowser();

    try {
      // Create strictly isolated BrowserContext - no shared cookies or disk cache
      const context = await browser.newContext({
        ignoreHTTPSErrors: false,
      });

      context.setDefaultTimeout(this.config.timeoutMs);
      context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);

      const page = await context.newPage();
      page.setDefaultTimeout(this.config.timeoutMs);
      page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);

      const sessionId = randomUUID();
      const now = new Date();

      const internalSession: InternalBrowserSession = {
        sessionId,
        context,
        page,
        currentUrl: null,
        title: null,
        status: 'IDLE',
        createdAt: now,
        lastActivityAt: now,
      };

      this.sessions.set(sessionId, internalSession);

      return {
        sessionId,
        status: 'IDLE',
        createdAt: now.toISOString(),
      };
    } catch (err: unknown) {
      if (err instanceof BrowserNotEnabledError || err instanceof BrowserCapacityError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserOperationError(`Failed to initialize browser session: ${message}`);
    }
  }

  /**
   * Retrieves sanitized metadata about an existing session.
   */
  getSession(sessionId: string): BrowserSessionDto {
    const session = this.getInternalSession(sessionId);
    return {
      sessionId: session.sessionId,
      status: session.status,
      currentUrl: session.currentUrl,
      title: session.title,
      createdAt: session.createdAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
    };
  }

  /**
   * Navigates the session's active page to a validated URL.
   */
  async navigate(
    sessionId: string,
    rawUrl: string,
    requestedTimeoutMs?: number
  ): Promise<PageMetadata & { sessionId: string }> {
    const session = this.getInternalSession(sessionId);

    // Validate URL safety and protocol strictly (HTTP/HTTPS only)
    const validUrl = validateBrowserUrl(rawUrl);
    const timeout = clampTimeout(requestedTimeoutMs, this.config.navigationTimeoutMs);

    session.status = 'ACTIVE';
    session.lastActivityAt = new Date();

    try {
      const response = await session.page.goto(validUrl.toString(), {
        timeout,
        waitUntil: 'domcontentloaded',
      });

      const currentUrl = session.page.url();
      const title = await session.page.title();

      session.currentUrl = currentUrl;
      session.title = title;
      session.lastActivityAt = new Date();

      let contentType: string | null = null;
      let status: number | null = null;

      if (response) {
        status = response.status();
        const headers = response.headers();
        contentType = headers['content-type'] || null;
      }

      return {
        sessionId,
        url: currentUrl,
        title,
        status,
        contentType,
      };
    } catch (err: unknown) {
      const errName = (err as { name?: string })?.name;
      const errMsg = (err as { message?: string })?.message || '';

      if (errName === 'TimeoutError' || errMsg.toLowerCase().includes('timeout')) {
        throw new BrowserNavigationTimeoutError(timeout, rawUrl);
      }

      throw new BrowserNavigationError(
        `Failed to navigate to "${rawUrl}": ${errMsg || 'Unknown navigation failure'}`
      );
    }
  }

  /**
   * Inspects basic diagnostic structural elements of the active page.
   * Does NOT interact with or submit forms.
   */
  async inspectPage(sessionId: string): Promise<PageInspection> {
    const session = this.getInternalSession(sessionId);
    session.lastActivityAt = new Date();

    try {
      const counts = await session.page.evaluate(() => {
        const forms = document.querySelectorAll('form').length;
        const inputs = document.querySelectorAll('input, select, textarea').length;
        const buttons = document.querySelectorAll(
          'button, input[type="button"], input[type="submit"], [role="button"]'
        ).length;
        const links = document.querySelectorAll('a[href]').length;

        return { forms, inputs, buttons, links };
      });

      const url = session.page.url();
      const title = await session.page.title();

      return {
        url,
        title,
        forms: counts.forms,
        inputs: counts.inputs,
        buttons: counts.buttons,
        links: counts.links,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserOperationError(`Failed to inspect page elements: ${message}`);
    }
  }

  /**
   * Executes a read-only evaluation function inside the active session page.
   * Strictly read-only; does not mutate the DOM or trigger actions.
   */
  async evaluateInSession<T>(sessionId: string, pageFunction: () => T): Promise<T> {
    const session = this.getInternalSession(sessionId);
    session.lastActivityAt = new Date();

    try {
      return await session.page.evaluate(pageFunction);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserOperationError(`Failed to evaluate in page: ${message}`);
    }
  }

  /**
   * Returns current URL, title, and response status for an active session.
   */
  async getPageInfo(sessionId: string): Promise<{ url: string; title: string; status: number | null }> {
    const session = this.getInternalSession(sessionId);
    session.lastActivityAt = new Date();
    const url = session.page.url();
    const title = await session.page.title();
    return {
      url,
      title,
      status: 200,
    };
  }

  /**
   * Captures a screenshot and saves it to the controlled screenshot directory.
   */
  async takeScreenshot(sessionId: string): Promise<ScreenshotResult> {
    const session = this.getInternalSession(sessionId);
    session.lastActivityAt = new Date();

    const screenshotId = randomUUID();
    const fileName = `${sessionId}-${screenshotId}.png`;

    // Ensure resolved destination stays strictly within configured screenshotDir
    const baseDir = path.resolve(this.config.screenshotDir);
    const targetPath = path.resolve(baseDir, fileName);

    if (!targetPath.startsWith(baseDir)) {
      throw new BrowserOperationError('Path traversal detected during screenshot save.');
    }

    try {
      await fs.mkdir(baseDir, { recursive: true });
      await session.page.screenshot({
        path: targetPath,
        fullPage: false,
      });

      const relativePath = path.relative(process.cwd(), targetPath).replace(/\\/g, '/');

      return {
        sessionId,
        screenshotId,
        path: relativePath,
        createdAt: new Date().toISOString(),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new BrowserOperationError(`Failed to capture screenshot: ${message}`);
    }
  }

  /**
   * Closes an active browser session and cleans up its page and isolated context.
   */
  async closeSession(sessionId: string): Promise<CloseBrowserSessionResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BrowserSessionNotFoundError(sessionId);
    }

    try {
      await session.page.close().catch(() => {});
      await session.context.close().catch(() => {});
    } finally {
      this.sessions.delete(sessionId);
    }

    return {
      success: true,
      sessionId,
    };
  }

  /**
   * Closes all active sessions.
   */
  async closeAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map((id) => this.closeSession(id).catch(() => {})));
  }

  /**
   * Shuts down all sessions and terminates the underlying browser process.
   */
  async closeBrowser(): Promise<void> {
    await this.closeAllSessions();
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  /**
   * Returns count of currently active in-memory sessions.
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Retrieves the active Page handle for a session.
   * Used exclusively by controlled browser automation services.
   */
  getPage(sessionId: string) {
    const session = this.getInternalSession(sessionId);
    session.lastActivityAt = new Date();
    return session.page;
  }

  /**
   * Helper to retrieve internal session or throw BrowserSessionNotFoundError.
   */
  private getInternalSession(sessionId: string): InternalBrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BrowserSessionNotFoundError(sessionId);
    }
    return session;
  }
}

export const browserService = new BrowserService();
