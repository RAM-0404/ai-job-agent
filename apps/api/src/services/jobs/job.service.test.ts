import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../db/prisma.js';
import { JobService, jobService, JobNotFoundError } from './job.service.js';
import type { JobIngestionInput } from '@ai-job-agent/shared';

describe('JobService Ingestion & Lifecycle', () => {
  const testSourceName = `JobService-Test-${Date.now()}`;
  let createdSourceId: string;

  after(async () => {
    // Thoroughly clean up all test entities
    if (createdSourceId) {
      await prisma.job.deleteMany({
        where: { jobSourceId: createdSourceId },
      });
      await prisma.discoveryRun.deleteMany({
        where: { jobSourceId: createdSourceId },
      });
      await prisma.jobSource.deleteMany({
        where: { id: createdSourceId },
      });
    }
  });

  test('creates new jobs on initial ingestion and logs DiscoveryRun', async () => {
    const input: JobIngestionInput = {
      source: {
        name: testSourceName,
        type: 'MANUAL',
        baseUrl: 'https://example.com',
      },
      jobs: [
        {
          externalId: 'job-srv-001',
          title: 'Senior Frontend Architect',
          companyName: 'Acme Systems',
          description: 'Building modern interfaces with React & TypeScript.',
          location: 'Bangalore, India',
          locations: ['Bangalore, India'],
          workMode: 'REMOTE',
          employmentType: 'FULL_TIME',
          experienceLevel: 'LEAD',
          salary: '$130k-$160k',
          applicationUrl: 'https://example.com/jobs/001',
          publishedAt: '2026-10-01T00:00:00Z',
        },
        {
          externalId: 'job-srv-002',
          title: 'Junior Backend Engineer',
          companyName: 'Acme Systems',
          description: 'Working with Node.js and PostgreSQL databases.',
          location: 'Coimbatore, India',
          workMode: 'HYBRID',
          employmentType: 'FULL_TIME',
          experienceLevel: 'JUNIOR',
          salary: '₹6 LPA - ₹10 LPA',
          applicationUrl: 'https://example.com/jobs/002',
          publishedAt: '2026-10-02T00:00:00Z',
        },
      ],
    };

    const result = await jobService.importJobs(input);
    createdSourceId = result.sourceId;

    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.jobsFetched, 2);
    assert.equal(result.jobsCreated, 2);
    assert.equal(result.jobsUpdated, 0);
    assert.equal(result.jobsSkipped, 0);

    // Verify DiscoveryRun record
    const run = await prisma.discoveryRun.findUnique({
      where: { id: result.runId },
    });
    assert.ok(run);
    assert.equal(run.status, 'COMPLETED');
    assert.equal(run.jobsCreated, 2);

    // Verify Jobs in database
    const jobs = await prisma.job.findMany({
      where: { jobSourceId: createdSourceId },
      orderBy: { externalId: 'asc' },
    });
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].title, 'Senior Frontend Architect');
    assert.equal(jobs[0].salaryMin, 130000);
    assert.equal(jobs[0].salaryMax, 160000);
    assert.equal(jobs[0].salaryCurrency, 'USD');
    assert.equal(jobs[1].title, 'Junior Backend Engineer');
    assert.equal(jobs[1].salaryMin, 600000);
    assert.equal(jobs[1].salaryMax, 1000000);
    assert.equal(jobs[1].salaryCurrency, 'INR');
  });

  test('skips identical jobs on repeated import without creating duplicates', async () => {
    const input: JobIngestionInput = {
      source: {
        name: testSourceName,
        type: 'MANUAL',
      },
      jobs: [
        {
          externalId: 'job-srv-001',
          title: 'Senior Frontend Architect',
          companyName: 'Acme Systems',
          description: 'Building modern interfaces with React & TypeScript.',
          location: 'Bangalore, India',
          locations: ['Bangalore, India'],
          workMode: 'REMOTE',
          employmentType: 'FULL_TIME',
          experienceLevel: 'LEAD',
          salary: '$130k-$160k',
          applicationUrl: 'https://example.com/jobs/001',
          publishedAt: '2026-10-01T00:00:00Z',
        },
      ],
    };

    const result = await jobService.importJobs(input);
    assert.equal(result.jobsFetched, 1);
    assert.equal(result.jobsCreated, 0);
    assert.equal(result.jobsUpdated, 0);
    assert.equal(result.jobsSkipped, 1);

    // Verify total job count in source remains 2
    const count = await prisma.job.count({
      where: { jobSourceId: createdSourceId },
    });
    assert.equal(count, 2);
  });

  test('updates existing job when fields have meaningfully changed', async () => {
    const input: JobIngestionInput = {
      source: {
        name: testSourceName,
        type: 'MANUAL',
      },
      jobs: [
        {
          externalId: 'job-srv-001',
          title: 'Staff Frontend Architect', // Changed title
          companyName: 'Acme Systems',
          description: 'Updated description with expanded responsibilities.',
          location: 'Bangalore, India',
          locations: ['Bangalore, India'],
          workMode: 'REMOTE',
          employmentType: 'FULL_TIME',
          experienceLevel: 'LEAD',
          salary: '$150k-$180k', // Changed salary
          applicationUrl: 'https://example.com/jobs/001',
          publishedAt: '2026-10-01T00:00:00Z',
        },
      ],
    };

    const result = await jobService.importJobs(input);
    assert.equal(result.jobsFetched, 1);
    assert.equal(result.jobsCreated, 0);
    assert.equal(result.jobsUpdated, 1);
    assert.equal(result.jobsSkipped, 0);

    // Verify updated job in database
    const updatedJob = await prisma.job.findFirst({
      where: { jobSourceId: createdSourceId, externalId: 'job-srv-001' },
    });
    assert.ok(updatedJob);
    assert.equal(updatedJob.title, 'Staff Frontend Architect');
    assert.equal(updatedJob.salaryMin, 150000);
    assert.equal(updatedJob.salaryMax, 180000);
  });

  test('retrieves jobs with search, filtering, and pagination', async () => {
    // 1. Search by title
    const searchRes = await jobService.getJobs({
      search: 'Backend',
      page: 1,
      pageSize: 10,
    });
    assert.ok(searchRes.jobs.length >= 1);
    assert.ok(searchRes.jobs.some((j) => j.title.includes('Backend')));

    // 2. Filter by workMode
    const remoteRes = await jobService.getJobs({
      workMode: 'REMOTE',
      page: 1,
      pageSize: 10,
    });
    assert.ok(remoteRes.jobs.length >= 1);
    assert.ok(remoteRes.jobs.every((j) => j.workMode === 'REMOTE'));

    // 3. Filter by location
    const locRes = await jobService.getJobs({
      location: 'Coimbatore',
      page: 1,
      pageSize: 10,
    });
    assert.ok(locRes.jobs.length >= 1);

    // 4. Pagination
    const pageRes = await jobService.getJobs({
      page: 1,
      pageSize: 1,
    });
    assert.equal(pageRes.pagination.pageSize, 1);
    assert.equal(pageRes.jobs.length, 1);
    assert.ok(pageRes.pagination.totalPages >= 2);
  });

  test('retrieves job by ID and throws JobNotFoundError for invalid ID', async () => {
    const existing = await prisma.job.findFirst({
      where: { jobSourceId: createdSourceId },
    });
    assert.ok(existing);

    const detail = await jobService.getJobById(existing.id);
    assert.equal(detail.id, existing.id);
    assert.ok(detail.jobSource);
    assert.equal(detail.jobSource.id, createdSourceId);

    await assert.rejects(
      async () => {
        await jobService.getJobById('00000000-0000-0000-0000-000000000000');
      },
      (err: Error) => {
        assert(err instanceof JobNotFoundError);
        return true;
      }
    );
  });
});
