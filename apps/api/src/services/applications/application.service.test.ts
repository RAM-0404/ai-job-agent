import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../db/prisma.js';
import {
  applicationService,
  InvalidStateTransitionError,
  ApplicationNotFoundError,
} from './application.service.js';

describe('ApplicationService - Lifecycle, State Machine & Export', () => {
  let testJobId: string;
  let testProfileId: string;
  let testApplicationId: string;

  before(async () => {
    // 1. Create candidate user profile
    const profile = await prisma.userProfile.create({
      data: {
        email: `test-applicant-${Date.now()}@example.com`,
        fullName: 'Jordan Test Applicant',
        currentTitle: 'Senior Full Stack Engineer',
        yearsOfExperience: 6,
        professionalSummary: 'Full stack developer experienced in TypeScript, Node, and React.',
        skills: {
          create: [
            { name: 'TypeScript', proficiency: 'Expert', category: 'Language' },
            { name: 'Node.js', proficiency: 'Expert', category: 'Backend' },
            { name: 'PostgreSQL', proficiency: 'Advanced', category: 'Database' },
          ],
        },
      },
    });
    testProfileId = profile.id;

    // 2. Create Job Source and Job
    const source = await prisma.jobSource.create({
      data: {
        name: `Source-${Date.now()}`,
        type: 'MANUAL',
      },
    });

    const job = await prisma.job.create({
      data: {
        jobSourceId: source.id,
        externalId: `ext-${Date.now()}`,
        title: 'Lead TypeScript Architect',
        companyName: 'Apex Innovations',
        description: 'Lead TypeScript architect needed for enterprise scale cloud microservices.',
        workMode: 'REMOTE',
        employmentType: 'FULL_TIME',
        experienceLevel: 'LEAD',
      },
    });
    testJobId = job.id;
  });

  after(async () => {
    // Cleanup created records
    if (testApplicationId) {
      await prisma.applicationAnswer.deleteMany({ where: { applicationId: testApplicationId } });
      await prisma.applicationDocument.deleteMany({ where: { applicationId: testApplicationId } });
      await prisma.application.deleteMany({ where: { id: testApplicationId } });
    }
    if (testJobId) {
      await prisma.job.deleteMany({ where: { id: testJobId } });
    }
    if (testProfileId) {
      await prisma.skill.deleteMany({ where: { userProfileId: testProfileId } });
      await prisma.userProfile.deleteMany({ where: { id: testProfileId } });
    }
  });

  test('createOrGetApplication initializes a new workspace in DRAFT state idempotently', async () => {
    const ws1 = await applicationService.createOrGetApplication(testJobId);

    assert.ok(ws1.application.id);
    assert.equal(ws1.application.jobId, testJobId);
    assert.equal(ws1.application.status, 'DRAFT');
    assert.equal(ws1.job.id, testJobId);
    assert.equal(ws1.job.companyName, 'Apex Innovations');

    testApplicationId = ws1.application.id;

    // Repeated call returns identical workspace
    const ws2 = await applicationService.createOrGetApplication(testJobId);
    assert.equal(ws2.application.id, testApplicationId);
  });

  test('updateApplication updates documents with USER_EDITED source tracking', async () => {
    const updated = await applicationService.updateApplication(testApplicationId, {
      documents: [
        {
          type: 'COVER_LETTER',
          content: 'Dear Apex Innovations, I am thrilled to apply for the Lead TypeScript Architect position.',
        },
        {
          type: 'APPLICATION_SUMMARY',
          content: 'Seasoned TypeScript engineer ready to lead architectural initiatives.',
        },
      ],
      answers: [
        {
          question: 'Why Apex Innovations?',
          answer: 'Because of your commitment to state of the art microservices.',
        },
      ],
    });

    assert.equal(updated.documents.COVER_LETTER?.source, 'USER_EDITED');
    assert.match(updated.documents.COVER_LETTER?.content || '', /Dear Apex Innovations/);
    assert.equal(updated.answers.length, 1);
    assert.equal(updated.answers[0].question, 'Why Apex Innovations?');
    assert.equal(updated.answers[0].source, 'USER_EDITED');
  });

  test('enforces strict state transitions: DRAFT -> IN_REVIEW -> APPROVED', async () => {
    // Attempting direct approval from DRAFT must be rejected
    await assert.rejects(
      async () => {
        await applicationService.approveApplication(testApplicationId);
      },
      InvalidStateTransitionError
    );

    // Transition DRAFT -> IN_REVIEW
    const inReviewWs = await applicationService.reviewApplication(testApplicationId);
    assert.equal(inReviewWs.application.status, 'IN_REVIEW');

    // Transition IN_REVIEW -> APPROVED
    const approvedWs = await applicationService.approveApplication(testApplicationId);
    assert.equal(approvedWs.application.status, 'APPROVED');
    assert.ok(approvedWs.application.approvedAt);
  });

  test('exportApplication generates local package files and transitions status to EXPORTED', async () => {
    const exportResult = await applicationService.exportApplication(testApplicationId);

    assert.equal(exportResult.applicationId, testApplicationId);
    assert.ok(exportResult.exportDirectory);
    assert.ok(exportResult.files.length >= 4);

    // Check disk files
    const fileNames = exportResult.files.map((f) => f.name);
    assert.ok(fileNames.includes('cover-letter.txt'));
    assert.ok(fileNames.includes('application-summary.txt'));
    assert.ok(fileNames.includes('resume-bullet-suggestions.txt'));
    assert.ok(fileNames.includes('answers.json'));

    for (const f of exportResult.files) {
      const exists = await fs
        .access(f.path)
        .then(() => true)
        .catch(() => false);
      assert.equal(exists, true, `File ${f.name} should exist on disk`);
    }

    // Verify application status changed to EXPORTED
    const finalWs = await applicationService.getApplicationWorkspace(testApplicationId);
    assert.equal(finalWs.application.status, 'EXPORTED');

    // Clean up exported directory
    await fs.rm(exportResult.exportDirectory, { recursive: true, force: true });
  });
});
