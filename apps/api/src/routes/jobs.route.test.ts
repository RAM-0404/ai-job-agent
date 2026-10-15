import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { prisma } from '../db/prisma.js';

describe('Job API Routes (/jobs)', () => {
  let app: FastifyInstance;
  const testSourceName = `Route-JobSource-${Date.now()}`;
  let createdJobId: string;
  let createdSourceId: string;

  before(async () => {
    app = await buildServer();
    await app.ready();
  });

  after(async () => {
    // Clean up test data
    await prisma.job.deleteMany({
      where: {
        jobSource: {
          name: { contains: 'Route-JobSource-' },
        },
      },
    });
    await prisma.discoveryRun.deleteMany({
      where: {
        jobSource: {
          name: { contains: 'Route-JobSource-' },
        },
      },
    });
    await prisma.jobSource.deleteMany({
      where: {
        name: { contains: 'Route-JobSource-' },
      },
    });

    await app.close();
  });

  test('GET /jobs returns empty list when no matching jobs exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/jobs?company=NonExistentCompanyXYZ',
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body.jobs, []);
    assert.equal(body.pagination.total, 0);
  });

  test('POST /jobs/import rejects invalid or empty payload with 400 Bad Request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/import',
      payload: {},
    });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.error);
  });

  test('POST /jobs/import successfully imports valid jobs and sanitizes malicious URLs', async () => {
    const payload = {
      source: {
        name: testSourceName,
        type: 'MANUAL',
        baseUrl: 'https://testjobs.example.com',
      },
      jobs: [
        {
          externalId: 'route-test-001',
          title: 'Staff Platform Engineer',
          companyName: 'Acme Cloud Corp',
          description: 'Managing Kubernetes and multi-cloud architecture.',
          location: 'Coimbatore, Tamil Nadu',
          locations: ['Coimbatore, Tamil Nadu', 'Remote'],
          workMode: 'REMOTE',
          employmentType: 'FULL_TIME',
          experienceLevel: 'LEAD',
          salary: '$140k-$175k',
          applicationUrl: 'https://testjobs.example.com/apply/001',
          publishedAt: '2026-10-01T00:00:00.000Z',
        },
        {
          externalId: 'route-test-002',
          title: 'Product Owner',
          companyName: 'Example Technologies',
          description: 'We are looking for an experienced Product Owner.',
          location: 'Coimbatore, Tamil Nadu',
          locations: ['Coimbatore, Tamil Nadu'],
          workMode: 'HYBRID',
          employmentType: 'FULL_TIME',
          experienceLevel: 'MID',
          salary: '₹8 LPA - ₹12 LPA',
          // Malicious URL attempt to test security sanitization
          applicationUrl: 'javascript:alert(document.cookie)',
          publishedAt: '2026-10-02T00:00:00.000Z',
        },
      ],
    };

    const res = await app.inject({
      method: 'POST',
      url: '/jobs/import',
      payload,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.jobsFetched, 2);
    assert.equal(body.jobsCreated, 2);
    assert.equal(body.jobsUpdated, 0);
    assert.equal(body.jobsSkipped, 0);
    assert.ok(body.runId);

    createdSourceId = body.sourceId;

    // Verify malicious URL was sanitized to null
    const jobWithMaliciousUrl = await prisma.job.findFirst({
      where: { jobSourceId: createdSourceId, externalId: 'route-test-002' },
    });
    assert.ok(jobWithMaliciousUrl);
    assert.equal(jobWithMaliciousUrl.applicationUrl, null);

    const firstJob = await prisma.job.findFirst({
      where: { jobSourceId: createdSourceId, externalId: 'route-test-001' },
    });
    assert.ok(firstJob);
    createdJobId = firstJob.id;
  });

  test('POST /jobs/import deduplicates identical repeated imports', async () => {
    const payload = {
      source: {
        name: testSourceName,
        type: 'MANUAL',
      },
      jobs: [
        {
          externalId: 'route-test-001',
          title: 'Staff Platform Engineer',
          companyName: 'Acme Cloud Corp',
          description: 'Managing Kubernetes and multi-cloud architecture.',
          location: 'Coimbatore, Tamil Nadu',
          locations: ['Coimbatore, Tamil Nadu', 'Remote'],
          workMode: 'REMOTE',
          employmentType: 'FULL_TIME',
          experienceLevel: 'LEAD',
          salary: '$140k-$175k',
          applicationUrl: 'https://testjobs.example.com/apply/001',
          publishedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
    };

    const res = await app.inject({
      method: 'POST',
      url: '/jobs/import',
      payload,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.jobsFetched, 1);
    assert.equal(body.jobsCreated, 0);
    assert.equal(body.jobsSkipped, 1);
  });

  test('GET /jobs returns paginated job list without rawPayload', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/jobs?page=1&pageSize=10',
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.jobs));
    assert.ok(body.jobs.length >= 2);
    assert.ok(body.pagination.total >= 2);

    // Verify rawPayload is not exposed in list responses
    assert.equal(body.jobs[0].rawPayload, undefined);
  });

  test('GET /jobs supports filtering by workMode, location, and search', async () => {
    // 1. Filter by workMode
    const remoteRes = await app.inject({
      method: 'GET',
      url: '/jobs?workMode=REMOTE',
    });
    const remoteBody = JSON.parse(remoteRes.body);
    assert.ok(remoteBody.jobs.length >= 1);
    assert.ok(remoteBody.jobs.every((j: any) => j.workMode === 'REMOTE'));

    // 2. Filter by location
    const locRes = await app.inject({
      method: 'GET',
      url: '/jobs?location=Coimbatore',
    });
    const locBody = JSON.parse(locRes.body);
    assert.ok(locBody.jobs.length >= 1);

    // 3. Search query
    const searchRes = await app.inject({
      method: 'GET',
      url: '/jobs?search=Product%20Owner',
    });
    const searchBody = JSON.parse(searchRes.body);
    assert.ok(searchBody.jobs.length >= 1);
    assert.ok(searchBody.jobs.some((j: any) => j.title === 'Product Owner'));
  });

  test('GET /jobs/:id returns complete job details and source info', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/jobs/${createdJobId}`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.id, createdJobId);
    assert.equal(body.title, 'Staff Platform Engineer');
    assert.ok(body.jobSource);
    assert.equal(body.jobSource.name, testSourceName);
  });

  test('GET /jobs/:id returns 404 Not Found for non-existent job ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/jobs/00000000-0000-0000-0000-000000000000',
    });

    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.statusCode, 404);
  });

  test('GET /jobs/discovery-runs returns recent discovery runs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/jobs/discovery-runs?page=1&pageSize=10',
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.runs));
    assert.ok(body.runs.length >= 1);
    assert.ok(body.runs.some((r: any) => r.jobSource?.name === testSourceName));
  });
});
