import dotenv from 'dotenv';
import path from 'node:path';

// Load .env from current directory or root if needed
dotenv.config();

export interface AppConfig {
  port: number;
  host: string;
  corsOrigin: string;
  nodeEnv: string;
  databaseUrl: string;
  uploadDir: string;
  maxResumeSizeMb: number;
  maxResumeSizeBytes: number;
  defaultUserEmail: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaTimeoutMs: number;
  maxAiResumeChars: number;
  exportDir: string;
  browserEnabled: boolean;
  browserHeadless: boolean;
  browserTimeoutMs: number;
  browserNavigationTimeoutMs: number;
  browserMaxContexts: number;
  browserScreenshotDir: string;
}

const parsedPort = Number(process.env.PORT);
const maxResumeSizeMb = Number(process.env.MAX_RESUME_SIZE_MB) || 10;
const parsedOllamaTimeout = Number(process.env.OLLAMA_TIMEOUT_MS);
const parsedMaxAiChars = Number(process.env.MAX_AI_RESUME_CHARS);
const parsedBrowserTimeout = Number(process.env.BROWSER_TIMEOUT_MS);
const parsedBrowserNavTimeout = Number(process.env.BROWSER_NAVIGATION_TIMEOUT_MS);
const parsedBrowserMaxContexts = Number(process.env.BROWSER_MAX_CONTEXTS);

function clamp(value: number, min: number, max: number, defaultValue: number): number {
  if (Number.isNaN(value) || value <= 0) return defaultValue;
  return Math.min(Math.max(value, min), max);
}

function normalizeBaseUrl(url: string | undefined, defaultUrl: string): string {
  if (!url) return defaultUrl;
  return url.trim().replace(/\/+$/, '');
}

export const config: AppConfig = {
  port: !Number.isNaN(parsedPort) && parsedPort > 0 ? parsedPort : 3000,
  host: process.env.HOST || '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/ai_job_agent?schema=public',
  uploadDir: process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'storage/resumes'),
  maxResumeSizeMb,
  maxResumeSizeBytes: maxResumeSizeMb * 1024 * 1024,
  defaultUserEmail: process.env.DEFAULT_USER_EMAIL || 'dev-user@ai-job-agent.local',
  ollamaBaseUrl: normalizeBaseUrl(process.env.OLLAMA_BASE_URL, 'http://host.docker.internal:11434'),
  ollamaModel: process.env.OLLAMA_MODEL?.trim() || 'qwen2.5:7b',
  ollamaTimeoutMs:
    !Number.isNaN(parsedOllamaTimeout) && parsedOllamaTimeout > 0 ? parsedOllamaTimeout : 120000,
  maxAiResumeChars:
    !Number.isNaN(parsedMaxAiChars) && parsedMaxAiChars > 0 ? parsedMaxAiChars : 30000,
  exportDir: process.env.EXPORT_DIR || path.resolve(process.cwd(), 'storage/exports/applications'),
  browserEnabled: process.env.BROWSER_ENABLED !== 'false',
  browserHeadless: process.env.BROWSER_HEADLESS !== 'false',
  browserTimeoutMs: clamp(parsedBrowserTimeout, 1000, 120000, 30000),
  browserNavigationTimeoutMs: clamp(parsedBrowserNavTimeout, 1000, 120000, 30000),
  browserMaxContexts: clamp(parsedBrowserMaxContexts, 1, 10, 1),
  browserScreenshotDir:
    process.env.BROWSER_SCREENSHOT_DIR ||
    path.resolve(process.cwd(), 'storage/browser/screenshots'),
};
