import path from 'node:path';
import { config } from '../../config/env.js';
import { InvalidBrowserUrlError } from './browser.errors.js';

export interface BrowserServiceConfig {
  enabled: boolean;
  headless: boolean;
  timeoutMs: number;
  navigationTimeoutMs: number;
  maxContexts: number;
  screenshotDir: string;
}

export function getBrowserConfig(): BrowserServiceConfig {
  return {
    enabled: config.browserEnabled,
    headless: config.browserHeadless,
    timeoutMs: config.browserTimeoutMs,
    navigationTimeoutMs: config.browserNavigationTimeoutMs,
    maxContexts: config.browserMaxContexts,
    screenshotDir: config.browserScreenshotDir,
  };
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_URL_LENGTH = 2048;

/**
 * Validates and sanitizes a URL before browser navigation.
 * Enforces http/https protocols and prevents local file access or script execution schemes.
 */
export function validateBrowserUrl(rawUrl: string): URL {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new InvalidBrowserUrlError('URL must be a non-empty string.');
  }

  const trimmed = rawUrl.trim();
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new InvalidBrowserUrlError(`URL exceeds maximum length of ${MAX_URL_LENGTH} characters.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InvalidBrowserUrlError('URL format is invalid or cannot be parsed.');
  }

  const protocol = parsed.protocol.toLowerCase();
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    throw new InvalidBrowserUrlError(
      `Protocol "${protocol}" is not permitted. Only HTTP and HTTPS navigation is allowed.`
    );
  }

  if (!parsed.hostname || parsed.hostname.length === 0) {
    throw new InvalidBrowserUrlError('URL host is missing or invalid.');
  }

  return parsed;
}

/**
 * Clamps user-provided timeouts within safe operating boundaries.
 */
export function clampTimeout(
  requestedTimeoutMs: number | undefined,
  defaultTimeoutMs: number,
  minMs = 1000,
  maxMs = 120000
): number {
  if (requestedTimeoutMs === undefined || requestedTimeoutMs === null || Number.isNaN(requestedTimeoutMs)) {
    return defaultTimeoutMs;
  }
  return Math.min(Math.max(requestedTimeoutMs, minMs), maxMs);
}
