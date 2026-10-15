import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import { buildServer } from '../server.js';
import { prisma } from '../db/prisma.js';

describe('Application Routes (Milestone 8 API)', () => {
  let app: FastifyInstance;
  let testProfileId: string;
  let testSourceId: string;
  let testJobId: string;
  let createdAppId: string;

  before(async () => {
    app = await buildServer();
    await app.ready();

    // Create Candidate Profile
    const profile = await prisma.userProfile.create({
      data: {
        fullName: 'Route Test Applicant',
        email: `app-route-${Date.now()}@example.com`,
        currentTitle: 'Senior Full Stack Engineer',
        yearsOfExperience: 6,
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
        name: `App Route Source ${Date.now()}`,
        type: 'MANUAL',
      },
    });
    testSourceId = source.id;

    const job = await prisma.job.create({
      data: {
        jobSourceId: testSourceId,
        title: 'Senior Solutions Engineer',
        companyName: 'CloudScale Inc',
        description: 'Seeking a Senior Solutions Engineer with Node.js and TypeScript skills.',
        location: 'Bengaluru',
        workMode: 'REMOTE',
        employmentType: 'FULL_TIME',
        experienceLevel: 'SENIOR',
      },
    });
    testJobId = job.id;
  });

  after(async () => {
    if (createdAppId) {
      await prisma.applicationAnswer.deleteMany({ where: { applicationId: createdAppId } });
      await prisma.applicationDocument.deleteMany({ where: { applicationId: createdAppId } });
      await prisma.application.deleteMany({ where: { id: createdAppId } });
    }
    if (testJobId) {
      await prisma.job.deleteMany({ where: { id: testJobId } });
    }
    if (testSourceId) {
      await prisma.jobSource.deleteMany({ where: { id: testSourceId } });
    }
    if (testProfileId) {
      await prisma.skill.deleteMany({ where: { userProfileId: testProfileId } });
      await prisma.userProfile.deleteMany({ where: { id: testProfileId } });
    }
    await app.close();
  });

  test('POST /jobs/:id/application initializes workspace in DRAFT status', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/jobs/${testJobId}/application`,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.application.id);
    assert.equal(body.application.status, 'DRAFT');
    assert.equal(body.job.id, testJobId);
    assert.equal(body.job.companyName, 'CloudScale Inc');

    createdAppId = body.application.id;
  });

  test('GET /applications retrieves paginated list containing created application', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/applications?page=1&pageSize=10',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.applications));
    assert.ok(body.pagination.total >= 1);
    const match = body.applications.find((a: any) => a.id === createdAppId);
    assert.ok(match, 'Created application should be present in results');
    assert.equal(match.status, 'DRAFT');
  });

  test('GET /applications/:id returns complete workspace', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/applications/${createdAppId}`,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.application.id, createdAppId);
    assert.equal(body.job.id, testJobId);
    assert.ok(body.documents);
  });

  test('PATCH /applications/:id updates cover letter with human edits', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/applications/${createdAppId}`,
      payload: {
        documents: [
          {
            type: 'COVER_LETTER',
            content: 'I am excited to apply for Senior Solutions Engineer at CloudScale Inc.',
          },
        ],
        answers: [
          {
            question: 'What is your availability?',
            answer: 'Immediately available.',
          },
        ],
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.documents.COVER_LETTER.source, 'USER_EDITED');
    assert.match(body.documents.COVER_LETTER.content, /CloudScale Inc/);
    assert.equal(body.answers.length, 1);
    assert.equal(body.answers[0].answer, 'Immediately available.');
  });

  test('POST /applications/:id/review transitions status from DRAFT to IN_REVIEW', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/applications/${createdAppId}/review`,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.application.status, 'IN_REVIEW');
  });

  test('POST /applications/:id/approve transitions status from IN_REVIEW to APPROVED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/applications/${createdAppId}/approve`,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.application.status, 'APPROVED');
    assert.ok(body.application.approvedAt);
  });

  test('POST /applications/:id/export generates local files and transitions to EXPORTED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/applications/${createdAppId}/export`,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.applicationId, createdAppId);
    assert.ok(body.exportDirectory);
    assert.ok(body.files.length >= 4);

    // Clean up exported directory
    await fs.rm(body.exportDirectory, { recursive: true, force: true });
  });
});
