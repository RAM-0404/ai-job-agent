import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { prisma } from '../db/prisma.js';
import { ollamaService } from '../services/ai/ollama.service.js';

describe('POST /profile/resumes/:id/analyze', () => {
  let app: FastifyInstance;
  let testProfileId: string;
  let validResumeId: string;
  let emptyTextResumeId: string;
  let originalGenerate: typeof ollamaService.generateStructured;

  before(async () => {
    app = await buildServer();
    await app.ready();

    originalGenerate = ollamaService.generateStructured.bind(ollamaService);

    // Create test user profile
    const profile = await prisma.userProfile.create({
      data: {
        fullName: 'Route Test User',
        email: `route-ai-${Date.now()}@example.com`,
      },
    });
    testProfileId = profile.id;

    // Resume with valid raw text
    const validResume = await prisma.resume.create({
      data: {
        userProfileId: testProfileId,
        fileName: 'valid.pdf',
        filePath: '/mock/valid.pdf',
        fileType: 'application/pdf',
        fileSize: 2048,
        rawText: 'Alice Smith - Principal Cloud Engineer with 10 years of experience in AWS, Kubernetes, and Go.',
        version: 1,
      },
    });
    validResumeId = validResume.id;

    // Resume without raw text
    const emptyResume = await prisma.resume.create({
      data: {
        userProfileId: testProfileId,
        fileName: 'empty.pdf',
        filePath: '/mock/empty.pdf',
        fileType: 'application/pdf',
        fileSize: 1024,
        rawText: null,
        version: 2,
      },
    });
    emptyTextResumeId = emptyResume.id;
  });

  after(async () => {
    ollamaService.generateStructured = originalGenerate;
    if (testProfileId) {
      await prisma.userProfile.delete({
        where: { id: testProfileId },
      });
    }
    await app.close();
  });

  test('returns 404 Not Found for non-existent resume ID', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({
      method: 'POST',
      url: `/profile/resumes/${fakeId}/analyze`,
    });

    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.statusCode, 404);
    assert.match(body.message, /not found/i);
  });

  test('returns 400 Bad Request when resume has no extracted plain text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/profile/resumes/${emptyTextResumeId}/analyze`,
    });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.statusCode, 400);
    assert.match(body.message, /no extracted text/i);
  });

  test('returns 200 OK with analysis summary on successful AI extraction and persistence', async () => {
    // Mock Ollama service to return valid profile
    ollamaService.generateStructured = (async () => {
      return {
        professionalSummary: 'Accomplished Cloud Infrastructure Engineer.',
        currentTitle: 'Principal Cloud Engineer',
        yearsOfExperience: 10,
        skills: [
          { name: 'Go', category: 'Languages', proficiency: 'Expert' },
          { name: 'Kubernetes', category: 'DevOps', proficiency: 'Expert' },
          { name: 'AWS', category: 'Cloud', proficiency: 'Expert' },
        ],
        experience: [
          {
            company: 'Cloud Scale Inc',
            jobTitle: 'Principal Cloud Engineer',
            startDate: '2020-01',
            endDate: null,
            isCurrent: true,
            description: 'Designed multi-region cloud architecture',
          },
        ],
        education: [
          {
            institution: 'Tech Institute',
            degree: 'BS in Computer Engineering',
            fieldOfStudy: 'Engineering',
            startDate: '2010',
            endDate: '2014',
            description: null,
          },
        ],
        projects: [
          {
            name: 'K8s Cluster Autoscaler',
            description: 'Custom controller for scaling workloads',
            technologies: ['Go', 'Kubernetes'],
          },
        ],
        certifications: [
          {
            name: 'AWS Certified Solutions Architect - Professional',
            issuer: 'Amazon Web Services',
            year: 2021,
          },
        ],
      };
    }) as any;

    const res = await app.inject({
      method: 'POST',
      url: `/profile/resumes/${validResumeId}/analyze`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);

    assert.equal(body.status, 'analyzed');
    assert.equal(body.resumeId, validResumeId);
    assert.equal(body.profile.currentTitle, 'Principal Cloud Engineer');
    assert.equal(body.profile.yearsOfExperience, 10);
    assert.equal(body.counts.skills, 3);
    assert.equal(body.counts.experience, 1);
    assert.equal(body.counts.education, 1);
    assert.equal(body.counts.projects, 1);
    assert.equal(body.counts.certifications, 1);
  });

  test('returns 422 Unprocessable Entity when AI output is malformed', async () => {
    ollamaService.generateStructured = (async () => {
      return {
        professionalSummary: 'Malformed profile',
        skills: 'This should be an array, but is a string',
      };
    }) as any;

    const res = await app.inject({
      method: 'POST',
      url: `/profile/resumes/${validResumeId}/analyze`,
    });

    assert.equal(res.statusCode, 422);
    const body = JSON.parse(res.body);
    assert.equal(body.statusCode, 422);
    assert.match(body.message, /schema validation/i);
  });

  test('returns 503 Service Unavailable when Ollama is unreachable', async () => {
    ollamaService.generateStructured = async () => {
      const { OllamaConnectionError } = await import('../services/ai/ollama.service.js');
      throw new OllamaConnectionError('Could not connect to Ollama at http://127.0.0.1:11434');
    };

    const res = await app.inject({
      method: 'POST',
      url: `/profile/resumes/${validResumeId}/analyze`,
    });

    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.equal(body.statusCode, 503);
    assert.match(body.message, /Could not connect to Ollama/i);
  });

  test('returns 504 Gateway Timeout when Ollama times out', async () => {
    ollamaService.generateStructured = async () => {
      const { OllamaTimeoutError } = await import('../services/ai/ollama.service.js');
      throw new OllamaTimeoutError('Ollama generation request timed out after 120000ms.');
    };

    const res = await app.inject({
      method: 'POST',
      url: `/profile/resumes/${validResumeId}/analyze`,
    });

    assert.equal(res.statusCode, 504);
    const body = JSON.parse(res.body);
    assert.equal(body.statusCode, 504);
    assert.match(body.message, /timed out/i);
  });
});
