import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  applicationService,
  ApplicationNotFoundError,
  InvalidStateTransitionError,
} from '../services/applications/application.service.js';
import { JobNotFoundError } from '../services/jobs/job.service.js';
import { CandidateProfileNotFoundError } from '../services/matching/job-match.service.js';
import { UnsupportedClaimError } from '../services/applications/application-validation.service.js';
import { AIOutputValidationError } from '../services/ai/job-match-ai.service.js';
import {
  OllamaConnectionError,
  OllamaTimeoutError,
  OllamaModelNotFoundError,
  OllamaInvalidJsonError,
  OllamaBusyError,
} from '../services/ai/ollama.service.js';
import type { ApplicationSearchParams } from '@ai-job-agent/shared';

const GenerateAnswersSchema = z.object({
  questions: z.array(z.string().min(1, 'Question cannot be empty')).min(1, 'At least one question is required'),
});

const UpdateApplicationSchema = z.object({
  documents: z
    .array(
      z.object({
        type: z.enum(['COVER_LETTER', 'RESUME_BULLETS', 'APPLICATION_SUMMARY']),
        content: z.string(),
      })
    )
    .optional(),
  answers: z
    .array(
      z.object({
        id: z.string().optional(),
        question: z.string().optional(),
        answer: z.string(),
      })
    )
    .optional(),
});

const ReviewSchema = z.object({
  action: z.enum(['START_REVIEW']).optional().default('START_REVIEW'),
});

const RejectSchema = z.object({
  reason: z.string().optional().default('Rejected by candidate during review.'),
});

export const applicationRoutes: FastifyPluginAsync = async (fastify) => {
  // Helper to handle AI errors uniformly
  const handleAiErrors = (err: unknown, reply: import('fastify').FastifyReply) => {
    if (err instanceof UnsupportedClaimError) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: err.message,
        suspiciousClaims: err.suspiciousClaims,
      });
    }

    if (err instanceof AIOutputValidationError) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Invalid AI response: output failed schema validation.',
        details: err.details,
      });
    }

    if (err instanceof OllamaInvalidJsonError) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: err.message,
      });
    }

    if (err instanceof OllamaTimeoutError) {
      return reply.status(504).send({
        statusCode: 504,
        error: 'Gateway Timeout',
        message: err.message,
      });
    }

    if (err instanceof OllamaConnectionError || err instanceof OllamaModelNotFoundError) {
      return reply.status(503).send({
        statusCode: 503,
        error: 'Service Unavailable',
        message: err.message,
      });
    }

    if (err instanceof OllamaBusyError) {
      return reply.status(429).send({
        statusCode: 429,
        error: 'Too Many Requests',
        message: err.message,
      });
    }

    return null;
  };

  // POST /jobs/:id/application - Create or retrieve Application workspace for job
  fastify.post<{ Params: { id: string } }>('/jobs/:id/application', async (request, reply) => {
    const jobId = request.params.id;
    if (!jobId) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Job ID is required.',
      });
    }

    try {
      const workspace = await applicationService.createOrGetApplication(jobId);
      return reply.status(200).send(workspace);
    } catch (err: unknown) {
      if (err instanceof JobNotFoundError || err instanceof CandidateProfileNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
        });
      }

      request.log.error(err, `Failed to create/get application for job ${jobId}`);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while initializing application.',
      });
    }
  });

  // GET /applications - Query filtered, paginated applications
  fastify.get<{ Querystring: Record<string, string | undefined> }>(
    '/applications',
    async (request, reply) => {
      try {
        const q = request.query;
        const params: ApplicationSearchParams = {
          page: q.page ? parseInt(q.page, 10) : 1,
          pageSize: q.pageSize ? Math.min(100, parseInt(q.pageSize, 10)) : 20,
          status: q.status as any,
          minimumScore: q.minimumScore !== undefined ? parseInt(q.minimumScore, 10) : undefined,
          company: q.company,
          search: q.search,
        };

        const result = await applicationService.getApplications(params);
        return reply.status(200).send(result);
      } catch (err: unknown) {
        request.log.error(err, 'Failed to fetch applications');
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'An unexpected error occurred while querying applications.',
        });
      }
    }
  );

  // GET /applications/:id - Complete application workspace
  fastify.get<{ Params: { id: string } }>('/applications/:id', async (request, reply) => {
    const id = request.params.id;
    try {
      const workspace = await applicationService.getApplicationWorkspace(id);
      return reply.status(200).send(workspace);
    } catch (err: unknown) {
      if (err instanceof ApplicationNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
        });
      }

      request.log.error(err, `Failed to fetch application workspace ${id}`);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while fetching application workspace.',
      });
    }
  });

  // POST /applications/:id/generate - Generate tailored summary, cover letter, resume bullets
  fastify.post<{ Params: { id: string } }>('/applications/:id/generate', async (request, reply) => {
    const id = request.params.id;
    try {
      const result = await applicationService.generateApplicationContent(id);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      if (err instanceof ApplicationNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
        });
      }

      const aiHandled = handleAiErrors(err, reply);
      if (aiHandled) return aiHandled;

      request.log.error(err, `Failed to generate application content for ${id}`);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred during application generation.',
      });
    }
  });

  // POST /applications/:id/answers/generate - Generate answers for arbitrary questions
  fastify.post<{ Params: { id: string } }>(
    '/applications/:id/answers/generate',
    async (request, reply) => {
      const id = request.params.id;
      const parseResult = GenerateAnswersSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid questions payload.',
          details: parseResult.error.format(),
        });
      }

      try {
        const result = await applicationService.generateAnswers(id, parseResult.data.questions);
        return reply.status(200).send(result);
      } catch (err: unknown) {
        if (err instanceof ApplicationNotFoundError) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            message: err.message,
          });
        }

        const aiHandled = handleAiErrors(err, reply);
        if (aiHandled) return aiHandled;

        request.log.error(err, `Failed to generate answers for application ${id}`);
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'An unexpected error occurred while generating answers.',
        });
      }
    }
  );

  // PATCH /applications/:id - Human editing of documents and answers
  fastify.patch<{ Params: { id: string } }>('/applications/:id', async (request, reply) => {
    const id = request.params.id;
    const parseResult = UpdateApplicationSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid update payload.',
        details: parseResult.error.format(),
      });
    }

    try {
      const updated = await applicationService.updateApplication(id, parseResult.data as any);
      return reply.status(200).send(updated);
    } catch (err: unknown) {
      if (err instanceof ApplicationNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
        });
      }

      request.log.error(err, `Failed to update application ${id}`);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while updating application.',
      });
    }
  });

  // POST /applications/:id/review - Move DRAFT -> IN_REVIEW
  fastify.post<{ Params: { id: string } }>('/applications/:id/review', async (request, reply) => {
    const id = request.params.id;
    ReviewSchema.safeParse(request.body);

    try {
      const workspace = await applicationService.reviewApplication(id);
      return reply.status(200).send(workspace);
    } catch (err: unknown) {
      if (err instanceof ApplicationNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
        });
      }

      if (err instanceof InvalidStateTransitionError) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err.message,
        });
      }

      request.log.error(err, `Failed to start review for application ${id}`);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while moving application to review.',
      });
    }
  });

  // POST /applications/:id/approve - Move IN_REVIEW -> APPROVED (Human Only)
  fastify.post<{ Params: { id: string } }>('/applications/:id/approve', async (request, reply) => {
    const id = request.params.id;
    try {
      const workspace = await applicationService.approveApplication(id);
      return reply.status(200).send(workspace);
    } catch (err: unknown) {
      if (err instanceof ApplicationNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
        });
      }

      if (err instanceof InvalidStateTransitionError) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err.message,
        });
      }

      request.log.error(err, `Failed to approve application ${id}`);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while approving application.',
      });
    }
  });

  // POST /applications/:id/reject - Move IN_REVIEW -> REJECTED (Human Only)
  fastify.post<{ Params: { id: string } }>('/applications/:id/reject', async (request, reply) => {
    const id = request.params.id;
    const parseResult = RejectSchema.safeParse(request.body || {});
    const reason = parseResult.success
      ? parseResult.data.reason
      : 'Rejected by candidate during review.';

    try {
      const workspace = await applicationService.rejectApplication(id, reason);
      return reply.status(200).send(workspace);
    } catch (err: unknown) {
      if (err instanceof ApplicationNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
        });
      }

      if (err instanceof InvalidStateTransitionError) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err.message,
        });
      }

      request.log.error(err, `Failed to reject application ${id}`);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while rejecting application.',
      });
    }
  });

  // POST /applications/:id/export - Generate local export package
  fastify.post<{ Params: { id: string } }>('/applications/:id/export', async (request, reply) => {
    const id = request.params.id;
    try {
      const exportResult = await applicationService.exportApplication(id);
      return reply.status(200).send(exportResult);
    } catch (err: unknown) {
      if (err instanceof ApplicationNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
        });
      }

      request.log.error(err, `Failed to export application ${id}`);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while exporting application.',
      });
    }
  });
};
