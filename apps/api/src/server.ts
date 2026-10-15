import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { config } from './config/env.js';
import { healthRoutes } from './routes/health.js';
import { profileRoutes } from './routes/profile.js';
import { resumeRoutes } from './routes/resume.js';
import { jobRoutes } from './routes/jobs.js';
import { applicationRoutes } from './routes/applications.js';
import { agentRoutes } from './routes/agent.js';
import { browserRoutes } from './routes/browser.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
  });

  // Register CORS to allow requests from the web frontend
  const allowedOrigins = [
    config.corsOrigin,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];

  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) {
        cb(null, true);
        return;
      }

      if (config.corsOrigin === '*' || allowedOrigins.includes(origin)) {
        cb(null, true);
        return;
      }

      cb(new Error(`Not allowed by CORS: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Register multipart plugin for file uploads
  await app.register(multipart, {
    limits: {
      fileSize: config.maxResumeSizeBytes,
      files: 1,
    },
  });

  // Register application routes
  await app.register(healthRoutes);
  await app.register(profileRoutes);
  await app.register(resumeRoutes);
  await app.register(jobRoutes);
  await app.register(applicationRoutes);
  await app.register(agentRoutes);
  await app.register(browserRoutes);

  return app;
}
