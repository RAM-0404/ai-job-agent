import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../db/prisma.js';
import { JobDeduplicationService, jobDeduplicationService } from './job-deduplication.service.js';
import type { NormalizedJobData } from './job-normalizer.service.js';

describe('JobDeduplicationService', () => {
  let sourceAId: string;
  let sourceBId: string;

  before(async () => {
    // Create isolated test sources
    const sourceA = await prisma.jobSource.create({
      data: {
        name: `Test-Source-A-${Date.now()}`,
        type: 'MANUAL',
        isActive: true,
      },
    });
    sourceAId = sourceA.id;

    const sourceB = await prisma.jobSource.create({
      data: {
        name: `Test-Source-B-${Date.now()}`,
        type: 'API',
        isActive: true,
      },
    });
    sourceBId = sourceB.id;
  });

  after(async () => {
    // Clean up all jobs and sources created during testing
    if (sourceAId || sourceBId) {
      await prisma.job.deleteMany({
        where: {
          jobSourceId: { in: [sourceAId, sourceBId].filter(Boolean) },
        },
      });
      await prisma.jobSource.deleteMany({
        where: {
          id: { in: [sourceAId, sourceBId].filter(Boolean) },
        },
      });
    }
  });

  describe('Fingerprint Generation', () => {
    test('generates deterministic fingerprint using company, title, and applicationUrl', () => {
      const normalized: NormalizedJobData = {
        externalId: null,
        title: 'Software Engineer',
        companyName: 'Acme Corp',
        description: 'Test job',
        location: 'Coimbatore',
        locations: ['Coimbatore'],
        workMode: 'REMOTE',
        employmentType: 'FULL_TIME',
        experienceLevel: 'MID',
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        applicationUrl: 'https://acme.com/apply/1',
        publishedAt: null,
        expiresAt: null,
        rawPayload: {},
      };

      const fp1 = jobDeduplicationService.generateFingerprint(normalized);
      const fp2 = jobDeduplicationService.generateFingerprint({
        ...normalized,
        companyName: '  ACME CORP  ',
        title: 'software engineer',
        applicationUrl: 'https://acme.com/apply/1',
      });

      assert.equal(fp1, 'acme corp|software engineer|https://acme.com/apply/1');
      assert.equal(fp1, fp2);
    });

    test('generates fingerprint using location when applicationUrl is unavailable', () => {
      const normalized: NormalizedJobData = {
        externalId: null,
        title: 'DevOps Specialist',
        companyName: 'Cloud Co',
        description: 'Test',
        location: 'Bangalore, India',
        locations: ['Bangalore, India'],
        workMode: 'HYBRID',
        employmentType: 'FULL_TIME',
        experienceLevel: 'SENIOR',
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        applicationUrl: null,
        publishedAt: null,
        expiresAt: null,
        rawPayload: {},
      };

      const fp = jobDeduplicationService.generateFingerprint(normalized);
      assert.equal(fp, 'cloud co|devops specialist|bangalore, india');
    });
  });

  describe('Database Deduplication Matching', () => {
    test('finds existing job by same source + same externalId', async () => {
      const externalId = 'ext-dedup-001';
      const createdJob = await prisma.job.create({
        data: {
          jobSourceId: sourceAId,
          externalId,
          title: 'Product Owner',
          companyName: 'Initech',
          description: 'Job description',
          workMode: 'HYBRID',
          employmentType: 'FULL_TIME',
          experienceLevel: 'MID',
          rawPayload: {},
        },
      });

      const normalized: NormalizedJobData = {
        externalId,
        title: 'Product Owner (Updated)',
        companyName: 'Initech',
        description: 'New desc',
        location: null,
        locations: [],
        workMode: 'HYBRID',
        employmentType: 'FULL_TIME',
        experienceLevel: 'MID',
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        applicationUrl: null,
        publishedAt: null,
        expiresAt: null,
        rawPayload: {},
      };

      const found = await jobDeduplicationService.findExistingJob(prisma, sourceAId, normalized);
      assert.ok(found);
      assert.equal(found.id, createdJob.id);
    });

    test('different sources with same externalId do NOT collide', async () => {
      const externalId = 'ext-shared-id';

      // Job exists under Source A
      await prisma.job.create({
        data: {
          jobSourceId: sourceAId,
          externalId,
          title: 'QA Engineer',
          companyName: 'Quality First',
          description: 'QA duties',
          workMode: 'REMOTE',
          employmentType: 'FULL_TIME',
          experienceLevel: 'ENTRY',
          rawPayload: {},
        },
      });

      const normalized: NormalizedJobData = {
        externalId,
        title: 'QA Engineer',
        companyName: 'Quality First',
        description: 'QA duties',
        location: null,
        locations: [],
        workMode: 'REMOTE',
        employmentType: 'FULL_TIME',
        experienceLevel: 'ENTRY',
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        applicationUrl: null,
        publishedAt: null,
        expiresAt: null,
        rawPayload: {},
      };

      // Searching under Source B should return null (no collision)
      const foundUnderSourceB = await jobDeduplicationService.findExistingJob(prisma, sourceBId, normalized);
      assert.equal(foundUnderSourceB, null);
    });

    test('deduplicates jobs without externalId using fallback fingerprint (company + title + applicationUrl)', async () => {
      const appUrl = 'https://startup.io/careers/lead-dev';
      const createdJob = await prisma.job.create({
        data: {
          jobSourceId: sourceAId,
          externalId: null,
          title: 'Lead Developer',
          companyName: 'Startup IO',
          description: 'Lead the team',
          applicationUrl: appUrl,
          workMode: 'REMOTE',
          employmentType: 'FULL_TIME',
          experienceLevel: 'LEAD',
          rawPayload: {},
        },
      });

      const normalized: NormalizedJobData = {
        externalId: null,
        title: 'lead developer',
        companyName: 'STARTUP IO',
        description: 'Fresh description',
        location: null,
        locations: [],
        workMode: 'REMOTE',
        employmentType: 'FULL_TIME',
        experienceLevel: 'LEAD',
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        applicationUrl: appUrl,
        publishedAt: null,
        expiresAt: null,
        rawPayload: {},
      };

      const found = await jobDeduplicationService.findExistingJob(prisma, sourceAId, normalized);
      assert.ok(found);
      assert.equal(found.id, createdJob.id);
    });

    test('hasChanged correctly identifies field updates vs unchanged records', async () => {
      const job = await prisma.job.create({
        data: {
          jobSourceId: sourceAId,
          externalId: 'ext-change-check',
          title: 'Data Analyst',
          companyName: 'Analytics Pro',
          description: 'Analyze data',
          workMode: 'ONSITE',
          employmentType: 'FULL_TIME',
          experienceLevel: 'MID',
          salaryMin: 50000,
          salaryMax: 70000,
          salaryCurrency: 'USD',
          rawPayload: {},
        },
      });

      // Identical normalized data
      const identicalData: NormalizedJobData = {
        externalId: 'ext-change-check',
        title: 'Data Analyst',
        companyName: 'Analytics Pro',
        description: 'Analyze data',
        location: null,
        locations: [],
        workMode: 'ONSITE',
        employmentType: 'FULL_TIME',
        experienceLevel: 'MID',
        salaryMin: 50000,
        salaryMax: 70000,
        salaryCurrency: 'USD',
        applicationUrl: null,
        publishedAt: null,
        expiresAt: null,
        rawPayload: {},
      };

      assert.equal(jobDeduplicationService.hasChanged(job, identicalData), false);

      // Modified salaryMax
      const modifiedData: NormalizedJobData = {
        ...identicalData,
        salaryMax: 85000,
      };

      assert.equal(jobDeduplicationService.hasChanged(job, modifiedData), true);
    });
  });
});
