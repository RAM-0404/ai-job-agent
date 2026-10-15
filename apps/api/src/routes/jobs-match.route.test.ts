import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { prisma } from '../db/prisma.js';
import { ollamaService } from '../services/ai/ollama.service.js';

describe('Job Matching Routes (POST /jobs/:id/match, GET /jobs/:id/match, GET /matches) (H)', () => {
  let app: FastifyInstance;
  let testProfileId: string;
  let testSourceId: string;
  let testJobId: string;
  let originalGenerate: typeof ollamaService.generateStructured;

  before(async () => {
    app = await buildServer();
    await app.ready();

    originalGenerate = ollamaService.generateStructured.bind(ollamaService);

    // Create Candidate Profile
    const profile = await prisma.userProfile.create({
      data: {
        fullName: 'Route Test Candidate',
        email: `route-match-${Date.now()}@example.com`,
        currentTitle: 'Lead Software Architect',
        yearsOfExperience: 8,
        skills: {
          create: [
            { name: 'TypeScript', category: 'Language' },
            { name: 'Node.js', category: 'Backend' },
            { name: 'PostgreSQL', category: 'Database' },
          ],
        },
      },
    });
    testProfileId = profile.id;

    // Create JobSource and Job
    const source = await prisma.jobSource.create({
      data: {
        name: `Route Match Source ${Date.now()}`,
        type: 'MANUAL',
      },
    });
    testSourceId = source.id;

    const job = await prisma.job.create({
      data: {
        jobSourceId: testSourceId,
        title: 'Lead Backend Engineer',
        companyName: 'Acme Systems',
        description: 'Seeking a Lead Backend Engineer with deep knowledge of Node.js and PostgreSQL.',
        location: 'Coimbatore',
        workMode: 'REMOTE',
        employmentType: 'FULL_TIME',
        experienceLevel: 'LEAD',
        salaryMin: 140000,
        salaryMax: 180000,
        salaryCurrency: 'USD',
      },
    });
    testJobId = job.id;
  });

  after(async () => {
    ollamaService.generateStructured = originalGenerate;

    if (testProfileId) {
      await prisma.userProfile.delete({ where: { id: testProfileId } }).catch(() => {});
    }
    if (testSourceId) {
      await prisma.jobSource.delete({ where: { id: testSourceId } }).catch(() => {});
    }
    await app.close();
  });

  test('POST /jobs/:id/match returns 404 for non-existent job ID', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({
      method: 'POST',
      url: `/jobs/${fakeId}/match`,
    });

    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.ok(body.message.includes('not found'));
  });

  test('GET /jobs/:id/match returns 404 when job has not been analyzed yet', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/jobs/${testJobId}/match`,
    });

    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.ok(body.message.includes('No match analysis found'));
  });

  test('POST /jobs/:id/match succeeds and returns structured match result', async () => {
    // Mock valid Ollama response
    ollamaService.generateStructured = (async <T>(): Promise<T> =>
      ({
        semanticSkillScore: 90,
        roleAlignmentScore: 92,
        responsibilityAlignmentScore: 88,
        strengths: ['Strong Node.js and TypeScript background', 'Proven architectural leadership'],
        gaps: ['No specific mention of distributed messaging systems'],
        explanation: 'Candidate exhibits exceptional technical and domain fit for the lead role.',
      } as unknown as T)) as any;

    const res = await app.inject({
      method: 'POST',
      url: `/jobs/${testJobId}/match`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.jobId, testJobId);
    assert.ok(body.overallScore >= 80, `Expected score >= 80, got ${body.overallScore}`);
    assert.equal(body.recommendation, 'APPLY');
    assert.equal(typeof body.scores.skill, 'number');
    assert.equal(typeof body.scores.experience, 'number');
    assert.equal(typeof body.scores.role, 'number');
    assert.equal(typeof body.scores.preference, 'number');
    assert.equal(typeof body.scores.location, 'number');
    assert.ok(Array.isArray(body.strengths));
    assert.ok(Array.isArray(body.gaps));
    assert.ok(body.explanation.length > 0);
  });

  test('GET /jobs/:id/match retrieves the stored match result', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/jobs/${testJobId}/match`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.jobId, testJobId);
    assert.equal(body.recommendation, 'APPLY');
    assert.ok(body.overallScore > 0);
  });

  test('GET /matches returns paginated matches with sorting', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/matches?page=1&pageSize=10&sort=overallScore_desc',
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.matches.length >= 1);
    assert.equal(body.matches[0].jobId, testJobId);
    assert.ok(body.matches[0].job);
    assert.equal(body.pagination.total, 1);
  });

  test('POST /jobs/:id/match handles 422 Unprocessable Entity when AI returns malformed JSON schema', async () => {
    ollamaService.generateStructured = (async <T>(): Promise<T> =>
      ({
        semanticSkillScore: 'invalid_not_number',
      } as unknown as T)) as any;

    const res = await app.inject({
      method: 'POST',
      url: `/jobs/${testJobId}/match`,
    });

    assert.equal(res.statusCode, 422);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Unprocessable Entity');
  });
});
