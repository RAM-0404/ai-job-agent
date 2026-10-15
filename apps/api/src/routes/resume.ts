import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db/prisma.js';
import { config } from '../config/env.js';
import { ensureUserProfileId } from '../services/profile.service.js';
import {
  uploadResume,
  getResumes,
  getResumeById,
  getResumeTextById,
  FileTooLargeError,
  ResumeNotFoundError,
} from '../services/resume/resume.service.js';
import { UnsupportedFileTypeError } from '../services/resume/resume-parser.service.js';
import {
  resumeAIService,
  ResumeNoTextError,
  ResumeTextTooLargeError,
  AIOutputValidationError,
} from '../services/ai/resume-ai.service.js';
import {
  OllamaConnectionError,
  OllamaTimeoutError,
  OllamaModelNotFoundError,
  OllamaInvalidJsonError,
  OllamaBusyError,
} from '../services/ai/ollama.service.js';

export const resumeRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /profile/resumes - Upload resume, extract text, and version
  fastify.post('/profile/resumes', async (request, reply) => {
    const data = await request.file({
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    });

    if (!data) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'No resume file found in multipart upload. Ensure form field is named "resume".',
      });
    }

    try {
      const buffer = await data.toBuffer();

      // Check if Fastify multipart truncated file due to size limit
      if (data.file.truncated) {
        return reply.status(413).send({
          statusCode: 413,
          error: 'Payload Too Large',
          message: 'The uploaded file exceeds the 10 MB maximum allowed size.',
        });
      }

      const userProfileId = await ensureUserProfileId();
      const result = await uploadResume({
        userProfileId,
        originalFileName: data.filename,
        fileType: data.mimetype,
        buffer,
      });

      return reply.status(201).send(result);
    } catch (err: unknown) {
      if (err instanceof UnsupportedFileTypeError) {
        return reply.status(415).send({
          statusCode: 415,
          error: 'Unsupported Media Type',
          message: err.message,
        });
      }

      if (err instanceof FileTooLargeError) {
        return reply.status(413).send({
          statusCode: 413,
          error: 'Payload Too Large',
          message: err.message,
        });
      }

      request.log.error(err, 'Failed to process resume upload');
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while processing the resume file.',
      });
    }
  });

  // GET /profile/resumes - Get resume upload history
  fastify.get('/profile/resumes', async (_request, reply) => {
    const userProfileId = await ensureUserProfileId();
    const history = await getResumes(userProfileId);
    return reply.status(200).send(history);
  });

  // GET /profile/resumes/:id - Get specific resume metadata
  fastify.get<{ Params: { id: string } }>('/profile/resumes/:id', async (request, reply) => {
    try {
      const resume = await getResumeById(request.params.id);
      return reply.status(200).send(resume);
    } catch (err: unknown) {
      if (err instanceof ResumeNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
        });
      }
      throw err;
    }
  });

  // GET /profile/resumes/:id/text - Debug/inspection endpoint for extracted text
  fastify.get<{ Params: { id: string } }>('/profile/resumes/:id/text', async (request, reply) => {
    try {
      const resumeText = await getResumeTextById(request.params.id);
      return reply.status(200).send(resumeText);
    } catch (err: unknown) {
      if (err instanceof ResumeNotFoundError) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: err.message,
        });
      }
      throw err;
    }
  });

  // POST /profile/resumes/:id/analyze - Analyze resume text with Ollama AI and enrich profile
  fastify.post<{ Params: { id: string } }>('/profile/resumes/:id/analyze', async (request, reply) => {
    const resumeId = request.params.id;
    const startTime = Date.now();

    try {
      // 1. Find resume in database
      const resume = await prisma.resume.findUnique({
        where: { id: resumeId },
      });

      // 2. Return 404 if not found
      if (!resume) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Resume with ID ${resumeId} not found`,
        });
      }

      // 3. Verify rawText exists and is not empty
      if (!resume.rawText || !resume.rawText.trim()) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Resume has no extracted text to analyze. Upload a document with extractable text.',
        });
      }

      // 4. Call ResumeAIService to extract structured profile
      const extracted = await resumeAIService.extractProfileFromText(resume.rawText);

      // 5. Persist normalized data into PostgreSQL
      const result = await resumeAIService.persistAnalysisData(
        resume.userProfileId,
        resume.id,
        extracted
      );

      const durationMs = Date.now() - startTime;
      request.log.info(
        {
          resumeId: resume.id,
          model: config.ollamaModel,
          durationMs,
          status: 'success',
        },
        'Resume AI analysis completed successfully'
      );

      return reply.status(200).send(result);
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;

      if (err instanceof ResumeNoTextError) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err.message,
        });
      }

      if (err instanceof ResumeTextTooLargeError) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: err.message,
        });
      }

      if (err instanceof AIOutputValidationError) {
        request.log.warn(
          {
            resumeId,
            model: config.ollamaModel,
            durationMs,
            errorCategory: 'AIOutputValidationError',
          },
          'AI output validation failed'
        );
        return reply.status(422).send({
          statusCode: 422,
          error: 'Unprocessable Entity',
          message: 'Invalid AI response: output failed schema validation.',
          details: err.details,
        });
      }

      if (err instanceof OllamaInvalidJsonError) {
        request.log.warn(
          {
            resumeId,
            model: config.ollamaModel,
            durationMs,
            errorCategory: 'OllamaInvalidJsonError',
          },
          'Ollama returned invalid JSON'
        );
        return reply.status(422).send({
          statusCode: 422,
          error: 'Unprocessable Entity',
          message: err.message,
        });
      }

      if (err instanceof OllamaTimeoutError) {
        request.log.warn(
          {
            resumeId,
            model: config.ollamaModel,
            durationMs,
            errorCategory: 'OllamaTimeoutError',
          },
          'Ollama generation timed out'
        );
        return reply.status(504).send({
          statusCode: 504,
          error: 'Gateway Timeout',
          message: err.message,
        });
      }

      if (err instanceof OllamaConnectionError || err instanceof OllamaModelNotFoundError) {
        request.log.warn(
          {
            resumeId,
            model: config.ollamaModel,
            durationMs,
            errorCategory: err.name,
          },
          'Ollama service unavailable'
        );
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

      request.log.error(
        {
          resumeId,
          model: config.ollamaModel,
          durationMs,
          errorCategory: err instanceof Error ? err.name : 'UnknownError',
        },
        'Unexpected error occurred during resume analysis'
      );

      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while analyzing the resume.',
      });
    }
  });
};
