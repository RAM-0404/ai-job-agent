export interface BrowserSessionDto {
  sessionId: string;
  status: 'IDLE' | 'ACTIVE' | 'CLOSED';
  currentUrl?: string | null;
  title?: string | null;
  createdAt: string;
  lastActivityAt: string;
}

export interface CreateBrowserSessionResponse {
  sessionId: string;
  status: 'IDLE' | 'ACTIVE';
  createdAt: string;
}

export interface NavigateBrowserRequest {
  url: string;
  timeoutMs?: number;
}

export interface NavigateBrowserResponse {
  sessionId: string;
  url: string;
  title: string;
  status?: number | null;
  contentType?: string | null;
}

export interface BrowserPageInspectionDto {
  url: string;
  title: string;
  forms: number;
  inputs: number;
  buttons: number;
  links: number;
}

export interface BrowserScreenshotDto {
  sessionId: string;
  screenshotId: string;
  path: string;
  createdAt: string;
}

export interface CloseBrowserSessionResponse {
  success: boolean;
  sessionId: string;
}
