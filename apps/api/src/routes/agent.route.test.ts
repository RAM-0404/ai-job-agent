import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { prisma } from '../db/prisma.js';

describe('Agent Routes (Milestone 9.1 API)', () => {
  let app: FastifyInstance;
  let testProfileId: string;
  let testSourceId: string;
  let testJobId: string;
  let createdRunIds: string[] = [];

  before(async () => {
    app = await buildServer();
    await app.ready();

    // Create Candidate Profile
    const profile = await prisma.userProfile.create({
      data: {
        fullName: 'Agent Route Candidate',
        email: `agent-route-${Date.now()}@example.com`,
        currentTitle: 'Staff Backend Engineer',
        yearsOfExperience: 8,
        skills: {
          create: [{ name: 'Node.js', category: 'Backend' }],
        },
      },
    });
    testProfileId = profile.id;

    // Create Job Source and Job
    const source = await prisma.jobSource.create({
      data: {
        name: `Agent Route Source ${Date.now()}`,
        type: 'MANUAL',
      },
    });
    testSourceId = source.id;

    const job = await prisma.job.create({
      data: {
        jobSourceId: testSourceId,
        title: 'Staff Systems Engineer',
        companyName: 'Distributed Systems Corp',
        description: 'Lead engineering for distributed orchestration systems.',
        workMode: 'REMOTE',
        employmentType: 'FULL_TIME',
        experienceLevel: 'SENIOR',
      },
    });
    testJobId = job.id;
  });

  after(async () => {
    for (const runId of createdRunIds) {
      await prisma.agentRunEvent.deleteMany({ where: { agentRunId: runId } });
      await prisma.agentRun.deleteMany({ where: { id: runId } });
    }
    if (testJobId) {
      const apps = await prisma.application.findMany({ where: { jobId: testJobId } });
      for (const a of apps) {
        await prisma.applicationAnswer.deleteMany({ where: { applicationId: a.id } });
        await prisma.applicationDocument.deleteMany({ where: { applicationId: a.id } });
        await prisma.application.delete({ where: { id: a.id } });
      }
      await prisma.jobMatch.deleteMany({ where: { jobId: testJobId } });
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

  test('POST /agent/runs creates a new run in IDLE state', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agent/runs',
      payload: {
        userProfileId: testProfileId,
        jobId: testJobId,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.ok(body.runId);
    assert.equal(body.status, 'IDLE');
    assert.equal(body.currentStep, 'INITIALIZE');

    createdRunIds.push(body.runId);
  });

  test('POST /agent/runs/:id/start advances workflow to WAITING_FOR_HUMAN', async () => {
    // Create run
    const createRes = await app.inject({
      method: 'POST',
      url: '/agent/runs',
      payload: {
        userProfileId: testProfileId,
        jobId: testJobId,
      },
    });
    const { runId } = createRes.json();
    createdRunIds.push(runId);

    // Start run
    const startRes = await app.inject({
      method: 'POST',
      url: `/agent/runs/${runId}/start`,
    });

    assert.equal(startRes.statusCode, 200);
    const run = startRes.json();
    assert.equal(run.status, 'WAITING_FOR_HUMAN');
    assert.equal(run.currentStep, 'HUMAN_REVIEW');
    assert.equal(run.decision, 'WAIT_FOR_HUMAN');
  });

  test('GET /agent/runs/:id returns run details', async () => {
    const runId = createdRunIds[0];
    const res = await app.inject({
      method: 'GET',
      url: `/agent/runs/${runId}`,
    });

    assert.equal(res.statusCode, 200);
    const run = res.json();
    assert.equal(run.id, runId);
    assert.equal(run.userProfileId, testProfileId);
  });

  test('GET /agent/runs/:id/events returns append-only chronological event history', async () => {
    const runId = createdRunIds[1]; // The started run
    const res = await app.inject({
      method: 'GET',
      url: `/agent/runs/${runId}/events`,
    });

    assert.equal(res.statusCode, 200);
    const events = res.json();
    assert.ok(Array.isArray(events));
    assert.ok(events.length >= 4);

    const steps = events.map((e: any) => e.step);
    assert.ok(steps.includes('INITIALIZE'));
    assert.ok(steps.includes('LOAD_CONTEXT'));
    assert.ok(steps.includes('EVALUATE'));
    assert.ok(steps.includes('HUMAN_REVIEW'));
  });

  test('POST /agent/runs/:id/approve resumes and completes workflow', async () => {
    const runId = createdRunIds[1]; // Currently in WAITING_FOR_HUMAN
    const res = await app.inject({
      method: 'POST',
      url: `/agent/runs/${runId}/approve`,
    });

    assert.equal(res.statusCode, 200);
    const run = res.json();
    assert.equal(run.status, 'COMPLETED');
    assert.equal(run.currentStep, 'COMPLETED');
    assert.equal(run.decision, 'APPROVED');
    assert.ok(run.completedAt);
  });

  test('POST /agent/runs/:id/reject terminates workflow to CANCELLED', async () => {
    // Create and start fresh run
    const createRes = await app.inject({
      method: 'POST',
      url: '/agent/runs',
      payload: {
        userProfileId: testProfileId,
        jobId: testJobId,
      },
    });
    const { runId } = createRes.json();
    createdRunIds.push(runId);

    await app.inject({
      method: 'POST',
      url: `/agent/runs/${runId}/start`,
    });

    // Reject run
    const rejectRes = await app.inject({
      method: 'POST',
      url: `/agent/runs/${runId}/reject`,
      payload: {
        reason: 'Compensation requirements not met.',
      },
    });

    assert.equal(rejectRes.statusCode, 200);
    const run = rejectRes.json();
    assert.equal(run.status, 'CANCELLED');
    assert.equal(run.decision, 'REJECTED');
    assert.equal(run.errorMessage, 'Compensation requirements not met.');
  });

  test('returns 400 when attempting approval outside of HUMAN_REVIEW', async () => {
    // Create new run in IDLE
    const createRes = await app.inject({
      method: 'POST',
      url: '/agent/runs',
      payload: {
        userProfileId: testProfileId,
        jobId: testJobId,
      },
    });
    const { runId } = createRes.json();
    createdRunIds.push(runId);

    // Try approve while IDLE
    const approveRes = await app.inject({
      method: 'POST',
      url: `/agent/runs/${runId}/approve`,
    });

    assert.equal(approveRes.statusCode, 400);
    const err = approveRes.json();
    assert.match(err.message, /Cannot perform action "APPROVE"/);
  });

  test('returns 404 for non-existent run ID', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({
      method: 'GET',
      url: `/agent/runs/${fakeId}`,
    });

    assert.equal(res.statusCode, 404);
  });
});
