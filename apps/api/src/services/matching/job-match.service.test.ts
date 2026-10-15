import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../db/prisma.js';
import { JobMatchService } from './job-match.service.js';
import type { JobMatchAIService } from '../ai/job-match-ai.service.js';

describe('JobMatchService - Persistence & Deduplication (G)', () => {
  let userProfileId: string;
  let jobSourceId: string;
  let jobId: string;
  let jobMatchService: JobMatchService;

  before(async () => {
    // 1. Create candidate profile with skills, experience, and preferences
    const profile = await prisma.userProfile.create({
      data: {
        fullName: `Test Candidate ${Date.now()}`,
        email: `match-persistence-${Date.now()}@test.com`,
        currentTitle: 'Senior Full Stack Engineer',
        yearsOfExperience: 6,
        skills: {
          create: [
            { name: 'TypeScript', category: 'Language' },
            { name: 'Node.js', category: 'Backend' },
            { name: 'React', category: 'Frontend' },
          ],
        },
        experiences: {
          create: [
            {
              company: 'Alpha Inc',
              jobTitle: 'Senior Software Engineer',
              startDate: new Date('2021-01-01'),
              isCurrent: true,
              description: 'Developed modern web applications with Node and React.',
            },
          ],
        },
        jobPreferences: {
          create: {
            preferredRoles: ['Full Stack Engineer', 'Backend Engineer'],
            preferredLocations: ['Coimbatore', 'Remote'],
            workModes: ['REMOTE'],
            minimumSalary: 110000,
          },
        },
      },
    });
    userProfileId = profile.id;

    // 2. Create JobSource and Job
    const source = await prisma.jobSource.create({
      data: {
        name: `Test Match Source ${Date.now()}`,
        type: 'MANUAL',
      },
    });
    jobSourceId = source.id;

    const job = await prisma.job.create({
      data: {
        jobSourceId,
        title: 'Full Stack Engineer',
        companyName: 'Beta Corp',
        description: 'Looking for a Full Stack Engineer experienced with TypeScript, React, and Node.js.',
        location: 'Coimbatore',
        workMode: 'REMOTE',
        employmentType: 'FULL_TIME',
        experienceLevel: 'SENIOR',
        salaryMin: 120000,
        salaryMax: 140000,
        salaryCurrency: 'USD',
      },
    });
    jobId = job.id;

    // 3. Mock AI service for deterministic test runs
    const mockAiService = {
      analyzeMatch: async () => ({
        semanticSkillScore: 92,
        roleAlignmentScore: 90,
        responsibilityAlignmentScore: 88,
        strengths: ['Direct hands-on experience with modern React & TypeScript'],
        gaps: [],
        explanation: 'Candidate is an outstanding match across all required parameters.',
      }),
    } as unknown as JobMatchAIService;

    jobMatchService = new JobMatchService(undefined, mockAiService);
  });

  after(async () => {
    // Clean up created records cleanly
    if (userProfileId) {
      await prisma.userProfile.delete({ where: { id: userProfileId } }).catch(() => {});
    }
    if (jobSourceId) {
      await prisma.jobSource.delete({ where: { id: jobSourceId } }).catch(() => {});
    }
  });

  test('creates new JobMatch record when matching for the first time', async () => {
    const result = await jobMatchService.matchJob(jobId, userProfileId);

    assert.equal(result.jobId, jobId);
    assert.ok(result.overallScore >= 80, `Expected score >= 80, got ${result.overallScore}`);
    assert.equal(result.recommendation, 'APPLY');
    assert.ok(result.strengths.length > 0);

    // Verify DB count
    const count = await prisma.jobMatch.count({
      where: { jobId, userProfileId },
    });
    assert.equal(count, 1, 'Exactly one JobMatch should exist');
  });

  test('updates existing JobMatch without creating duplicate record on re-matching', async () => {
    // Initial ID
    const initialMatch = await prisma.jobMatch.findUnique({
      where: {
        jobId_userProfileId: { jobId, userProfileId },
      },
    });
    assert.ok(initialMatch, 'Initial match must exist');

    // Run re-match
    const reResult = await jobMatchService.matchJob(jobId, userProfileId);
    assert.equal(reResult.id, initialMatch.id, 'Record ID must remain identical on re-match');

    // Verify DB count remains strictly 1
    const count = await prisma.jobMatch.count({
      where: { jobId, userProfileId },
    });
    assert.equal(count, 1, 'Should NOT create duplicate JobMatch records');
  });

  test('retrieves stored match with GET /jobs/:id/match logic', async () => {
    const match = await jobMatchService.getMatchByJobId(jobId, userProfileId);
    assert.equal(match.jobId, jobId);
    assert.ok(match.overallScore > 0);
    assert.equal(match.recommendation, 'APPLY');
  });

  test('retrieves paginated list of matches with sorting and score filters', async () => {
    const result = await jobMatchService.getMatches({
      minimumScore: 70,
      recommendation: 'APPLY',
      sort: 'overallScore_desc',
      page: 1,
      pageSize: 10,
    });

    assert.ok(result.matches.length >= 1);
    assert.equal(result.matches[0].jobId, jobId);
    assert.equal(result.pagination.total, 1);
  });
});
