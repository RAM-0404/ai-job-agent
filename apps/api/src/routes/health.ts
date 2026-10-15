import type { FastifyPluginAsync } from 'fastify';
import type { HealthCheckResponse } from '@ai-job-agent/shared';
import { checkSystemHealth } from '../services/health.service.js';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: HealthCheckResponse }>('/health', async (_request, reply) => {
    const health = await checkSystemHealth();
    const statusCode = health.status === 'ok' ? 200 : 503;
    return reply.status(statusCode).send(health);
  });
};
