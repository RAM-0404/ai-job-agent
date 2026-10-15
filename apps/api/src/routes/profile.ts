import type { FastifyPluginAsync } from 'fastify';
import type { UserProfileResponse, UpdateProfileRequest } from '@ai-job-agent/shared';
import {
  getCurrentProfile,
  updateOrCreateProfile,
} from '../services/profile.service.js';

export const profileRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /profile - Retrieve current user profile
  fastify.get('/profile', async (_request, reply) => {
    const profile = await getCurrentProfile();
    if (!profile) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'User profile has not been created yet',
      });
    }
    return reply.status(200).send(profile);
  });

  // PUT /profile - Create or update current user profile
  fastify.put<{ Body: UpdateProfileRequest }>('/profile', async (request, reply) => {
    const body = request.body;

    if (!body || !body.fullName || !body.email) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Both fullName and email are required fields',
      });
    }

    const updated = await updateOrCreateProfile(body);
    return reply.status(200).send(updated);
  });
};
