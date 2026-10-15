import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { jobService, JobNotFoundError } from '../services/jobs/job.service.js';
import {
  jobMatchService,
  CandidateProfileNotFoundError,
  MatchNotFoundError,
} from '../services/matching/job-match.service.js';
import { AIOutputValidationError } from '../services/ai/job-match-ai.service.js';
import {
  OllamaConnectionError,
  OllamaTimeoutError,
  OllamaModelNotFoundError,
  OllamaInvalidJsonError,
  OllamaBusyError,
} from '../services/ai/ollama.service.js';
import type { JobSearchParams, JobMatchSearchParams } from '@ai-job-agent/shared';

const JobImportSchema = z.object({
  source: z.object({
    name: z.string().min(1, 'Source name is required'),
    type: z.enum(['MANUAL', 'API', 'FEED', 'CAREER_PAGE']).optional().default('MANUAL'),
    baseUrl: z.string().nullable().optional(),
  }),
  jobs: z
    .array(
      z.object({
        externalId: z.string().nullable().optional(),
        title: z.string().min(1, 'Job title is required'),
        companyName: z.string().min(1, 'Company name is required'),
        description: z.string().min(1, 'Description is required'),
        location: z.string().nullable().optional(),
        locations: z.array(z.string()).optional(),
        workMode: z.string().nullable().optional(),
        employmentType: z.string().nullable().optional(),
        experienceLevel: z.string().nullable().optional(),
        salary: z.any().optional(),
        salaryMin: z.number().nullable().optional(),
        salaryMax: z.number().nullable().optional(),
        salaryCurrency: z.string().nullable().optional(),
        applicationUrl: z.string().nullable().optional(),
        publishedAt: z.union([z.string(), z.date()]).nullable().optional(),
        expiresAt: z.union([z.string(), z.date()]).nullable().optional(),
        rawPayload: z.any().optional(),
      })
    )
    .min(1, 'At least one job is required in jobs array'),
});

export const jobRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /jobs - Query filtered, paginated jobs
  fastify.get<{ Querystring: Record<string, string | undefined> }>('/jobs', async (request, reply) => {
    try {
      const q = request.query;
      const params: JobSearchParams = {
        search: q.search,
        company: q.company,
        location: q.location,
        workMode: q.workMode as any,
        employmentType: q.employmentType as any,
        experienceLevel: q.experienceLevel as any,
        publishedAfter: q.publishedAfter,
        publishedBefore: q.publishedBefore,
        page: q.page ? parseInt(q.page, 10) : 1,
        pageSize: q.pageSize ? parseInt(q.pageSize, 10) : 20,
      };

      const result = await jobService.getJobs(params);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to fetch jobs');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while fetching jobs.',
      });
    }
  });

  // GET /jobs/discovery-runs - Retrieve recent ingestion runs
  fastify.get('/jobs/discovery-runs', async (_request, reply) => {
    try {
      const runs = await jobService.getDiscoveryRuns(20);
      return reply.status(200).send(runs);
    } catch (err: unknown) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Failed to retrieve discovery runs.',
      });
    }
  });

  // GET /jobs/:id - Retrieve job details by ID
  fastify.get<{ Params: { id: string } }>('/jobs/:id', async (request, reply) => {
    try {
      const job = await jobService.getJobById(request.params.id);
      return reply.status(200).send(job);
    } catch (err: unknown) {
      if (err instanceof JobNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
        });
      }

      request.log.error(err, 'Failed to fetch job by ID');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while fetching job details.',
      });
    }
  });

  // POST /jobs/import - Manual or source job ingestion endpoint
  fastify.post('/jobs/import', async (request, reply) => {
    const parseResult = JobImportSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid job import payload structure.',
        details: parseResult.error.format(),
      });
    }

    try {
      const result = await jobService.importJobs(parseResult.data);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to import jobs');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Failed to process job import.',
      });
    }
  });

  // POST /jobs/:id/match - Run AI and deterministic matching for the specified job
  fastify.post<{ Params: { id: string } }>('/jobs/:id/match', async (request, reply) => {
    const jobId = request.params.id;
    if (!jobId) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Job ID is required.',
      });
    }

    try {
      const result = await jobMatchService.matchJob(jobId);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      if (err instanceof JobNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
        });
      }

      if (err instanceof CandidateProfileNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
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

      request.log.error(err, `Unexpected error evaluating match for job ${jobId}`);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while matching the job.',
      });
    }
  });

  // GET /jobs/:id/match - Retrieve stored match for a job
  fastify.get<{ Params: { id: string } }>('/jobs/:id/match', async (request, reply) => {
    const jobId = request.params.id;
    if (!jobId) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Job ID is required.',
      });
    }

    try {
      const match = await jobMatchService.getMatchByJobId(jobId);
      return reply.status(200).send(match);
    } catch (err: unknown) {
      if (err instanceof CandidateProfileNotFoundError || err instanceof MatchNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
        });
      }

      request.log.error(err, `Failed to retrieve match for job ${jobId}`);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while retrieving job match.',
      });
    }
  });

  // Handler for paginated matches
  const handleGetMatches = async (
    request: import('fastify').FastifyRequest<{ Querystring: Record<string, string | undefined> }>,
    reply: import('fastify').FastifyReply
  ) => {
    try {
      const q = request.query;
      const params: JobMatchSearchParams = {
        page: q.page ? parseInt(q.page, 10) : 1,
        pageSize: q.pageSize ? Math.min(100, parseInt(q.pageSize, 10)) : 10,
        minimumScore: q.minimumScore !== undefined ? parseInt(q.minimumScore, 10) : undefined,
        recommendation: q.recommendation as any,
        sort: q.sort as any,
      };

      const result = await jobMatchService.getMatches(params);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      request.log.error(err, 'Failed to retrieve job matches list');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while retrieving matches.',
      });
    }
  };

  // GET /matches - Query paginated matches for active profile
  fastify.get<{ Querystring: Record<string, string | undefined> }>('/matches', handleGetMatches);
  // Also register GET /jobs/matches as alias
  fastify.get<{ Querystring: Record<string, string | undefined> }>('/jobs/matches', handleGetMatches);
};
