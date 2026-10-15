import type { BrowserContext, Page } from 'playwright';
import type {
  BrowserSessionDto,
  BrowserPageInspectionDto,
  BrowserScreenshotDto,
  NavigateBrowserResponse,
} from '@ai-job-agent/shared';

export interface InternalBrowserSession {
  sessionId: string;
  context: BrowserContext;
  page: Page;
  currentUrl: string | null;
  title: string | null;
  status: 'IDLE' | 'ACTIVE' | 'CLOSED';
  createdAt: Date;
  lastActivityAt: Date;
}

export interface PageMetadata {
  url: string;
  title: string;
  status?: number | null;
  contentType?: string | null;
}

export interface PageInspection extends BrowserPageInspectionDto {}

export interface ScreenshotResult extends BrowserScreenshotDto {}

export interface NavigateOptions {
  url: string;
  timeoutMs?: number;
}
