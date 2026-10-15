import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { agentService } from '../services/agent/agent.service.js';
import {
  AgentRunNotFoundError,
  AgentContextNotFoundError,
  InvalidAgentStateTransitionError,
  AgentActionNotAllowedError,
} from '../services/agent/agent.errors.js';

const CreateRunSchema = z.object({
  userProfileId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  applicationId: z.string().uuid().optional(),
});

const RejectRunSchema = z.object({
  reason: z.string().optional(),
});

export const agentRoutes: FastifyPluginAsync = async (fastify) => {
  // Common error handling helper
  const handleRouteErrors = (err: unknown, reply: import('fastify').FastifyReply) => {
    if (err instanceof AgentRunNotFoundError || err instanceof AgentContextNotFoundError) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: err.message,
      });
    }

    if (
      err instanceof InvalidAgentStateTransitionError ||
      err instanceof AgentActionNotAllowedError
    ) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: err.message,
      });
    }

    return null;
  };

  // POST /agent/runs - Create a new agent run
  fastify.post('/agent/runs', async (request, reply) => {
    const parseResult = CreateRunSchema.safeParse(request.body || {});
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid create run payload.',
        details: parseResult.error.format(),
      });
    }

    try {
      const run = await agentService.createRun(parseResult.data);
      return reply.status(201).send({
        runId: run.id,
        status: run.status,
        currentStep: run.currentStep,
      });
    } catch (err: unknown) {
      const handled = handleRouteErrors(err, reply);
      if (handled) return handled;

      request.log.error(err, 'Failed to create agent run');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while creating the agent run.',
      });
    }
  });

  // POST /agent/runs/:id/start - Start the agent workflow
  fastify.post<{ Params: { id: string } }>('/agent/runs/:id/start', async (request, reply) => {
    const { id } = request.params;
    try {
      const run = await agentService.startRun(id);
      return reply.status(200).send(run);
    } catch (err: unknown) {
      const handled = handleRouteErrors(err, reply);
      if (handled) return handled;

      request.log.error(err, `Failed to start agent run ${id}`);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while starting the agent run.',
      });
    }
  });

  // GET /agent/runs/:id - Get agent run details and status
  fastify.get<{ Params: { id: string } }>('/agent/runs/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const run = await agentService.getRun(id);
      return reply.status(200).send(run);
    } catch (err: unknown) {
      const handled = handleRouteErrors(err, reply);
      if (handled) return handled;

      request.log.error(err, `Failed to get agent run ${id}`);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while fetching the agent run.',
      });
    }
  });

  // GET /agent/runs/:id/events - Get chronological event history
  fastify.get<{ Params: { id: string } }>('/agent/runs/:id/events', async (request, reply) => {
    const { id } = request.params;
    try {
      const events = await agentService.getRunEvents(id);
      return reply.status(200).send(events);
    } catch (err: unknown) {
      const handled = handleRouteErrors(err, reply);
      if (handled) return handled;

      request.log.error(err, `Failed to fetch events for agent run ${id}`);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while fetching agent run events.',
      });
    }
  });

  // POST /agent/runs/:id/approve - Approve workflow continuation during HUMAN_REVIEW
  fastify.post<{ Params: { id: string } }>('/agent/runs/:id/approve', async (request, reply) => {
    const { id } = request.params;
    try {
      const run = await agentService.approveRun(id);
      return reply.status(200).send(run);
    } catch (err: unknown) {
      const handled = handleRouteErrors(err, reply);
      if (handled) return handled;

      request.log.error(err, `Failed to approve agent run ${id}`);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while approving the agent run.',
      });
    }
  });

  // POST /agent/runs/:id/reject - Reject workflow continuation during HUMAN_REVIEW
  fastify.post<{ Params: { id: string } }>('/agent/runs/:id/reject', async (request, reply) => {
    const { id } = request.params;
    const parseResult = RejectRunSchema.safeParse(request.body || {});
    const reason = parseResult.success ? parseResult.data.reason : undefined;

    try {
      const run = await agentService.rejectRun(id, reason);
      return reply.status(200).send(run);
    } catch (err: unknown) {
      const handled = handleRouteErrors(err, reply);
      if (handled) return handled;

      request.log.error(err, `Failed to reject agent run ${id}`);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while rejecting the agent run.',
      });
    }
  });
};
