import { prisma } from '../db/prisma.js';
import { ollamaService } from './ai/ollama.service.js';
import { config } from '../config/env.js';
import type { HealthCheckResponse } from '@ai-job-agent/shared';

export async function checkSystemHealth(): Promise<HealthCheckResponse> {
  let isDbConnected = false;
  let isOllamaConnected = false;

  try {
    // Lightweight round-trip ping to verify active PostgreSQL database connectivity
    await prisma.$queryRaw`SELECT 1`;
    isDbConnected = true;
  } catch {
    isDbConnected = false;
  }

  try {
    // Lightweight non-blocking connectivity check to Ollama HTTP API (2 second timeout)
    isOllamaConnected = await ollamaService.checkConnectivity(2000);
  } catch {
    isOllamaConnected = false;
  }

  // Primary API health depends on database connectivity.
  // Ollama status is independently reported without failing the API container.
  return {
    status: isDbConnected ? 'ok' : 'degraded',
    service: 'api',
    database: isDbConnected ? 'connected' : 'disconnected',
    ollama: isOllamaConnected ? 'connected' : 'disconnected',
    ollamaModel: config.ollamaModel,
    browser: {
      enabled: config.browserEnabled,
    },
  };
}
