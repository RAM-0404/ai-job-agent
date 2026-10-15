import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DeterministicMatchService,
  type CandidateProfileData,
} from './deterministic-match.service.js';
import type { Job } from '@ai-job-agent/shared';

function createMockJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'mock-job-1',
    jobSourceId: 'source-1',
    externalId: 'ext-1',
    title: 'Senior Software Engineer',
    companyName: 'TechCorp',
    description: 'We are looking for a Senior Software Engineer with Node.js and PostgreSQL experience.',
    location: 'Coimbatore, Tamil Nadu',
    locations: ['Coimbatore'],
    workMode: 'REMOTE',
    employmentType: 'FULL_TIME',
    experienceLevel: 'SENIOR',
    salaryMin: 120000,
    salaryMax: 150000,
    salaryCurrency: 'USD',
    applicationUrl: 'https://techcorp.com/jobs/1',
    publishedAt: new Date().toISOString(),
    expiresAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockCandidate(overrides: Partial<CandidateProfileData> = {}): CandidateProfileData {
  return {
    id: 'mock-cand-1',
    fullName: 'Alice Developer',
    currentTitle: 'Senior Full Stack Engineer',
    yearsOfExperience: 5,
    skills: [
      { name: 'Node.js', category: 'Backend', proficiency: 'Expert' },
      { name: 'PostgreSQL', category: 'Database', proficiency: 'Advanced' },
      { name: 'TypeScript', category: 'Language', proficiency: 'Expert' },
    ],
    experiences: [
      {
        company: 'Innovatech',
        jobTitle: 'Senior Software Engineer',
        description: 'Built scalable backend systems using Node.js, TypeScript, and Postgres.',
      },
    ],
    jobPreferences: {
      preferredRoles: ['Software Engineer', 'Full Stack Engineer'],
      preferredLocations: ['Coimbatore', 'Remote'],
      workModes: ['REMOTE', 'HYBRID'],
      preferredIndustries: ['Technology', 'Fintech'],
      minimumSalary: 100000,
      salaryCurrency: 'USD',
    },
    ...overrides,
  };
}

describe('DeterministicMatchService - Skill Matching (A)', () => {
  test('matches canonical synonyms: Node.js ≈ Node and Postgres ≈ PostgreSQL', () => {
    const job = createMockJob({
      description: 'Requirements: Must know Node and Postgres.',
    });

    const candidate = createMockCandidate({
      skills: [
        { name: 'nodejs', category: 'Backend' },
        { name: 'postgresql', category: 'Database' },
      ],
    });

    const result = DeterministicMatchService.matchSkills(candidate.skills, job);

    assert.ok(result.score > 70, `Expected score > 70, got ${result.score}`);
    assert.ok(
      result.matchedSkills.some((s) => s.toLowerCase().includes('node')),
      'Should recognize Node.js as nodejs'
    );
    assert.ok(
      result.matchedSkills.some((s) => s.toLowerCase().includes('postgres')),
      'Should recognize Postgres as postgresql'
    );
  });

  test('performs case-insensitive skill matching', () => {
    const job = createMockJob({
      description: 'Requirements: DOCKER, KUBERNETES, PYTHON.',
    });

    const candidate = createMockCandidate({
      skills: [
        { name: 'docker' },
        { name: 'kubernetes' },
        { name: 'python' },
      ],
    });

    const result = DeterministicMatchService.matchSkills(candidate.skills, job);

    assert.ok(result.score >= 80, `Expected high score for case-insensitive match, got ${result.score}`);
    assert.equal(result.missingSkills.length, 0);
  });

  test('identifies missing skills correctly when candidate lacks key requirements', () => {
    const job = createMockJob({
      description: 'Requirements: Docker, Kubernetes, Python, AWS.',
    });

    const candidate = createMockCandidate({
      skills: [{ name: 'PHP' }],
    });

    const result = DeterministicMatchService.matchSkills(candidate.skills, job);

    assert.ok(result.score <= 30, `Expected low score for completely missing skills, got ${result.score}`);
    assert.ok(result.missingSkills.length > 0, 'Should list missing skills');
  });
});

describe('DeterministicMatchService - Experience Matching (B)', () => {
  test('awards strong score when candidate experience aligns with job level', () => {
    // 5 years vs SENIOR (4-7 years)
    const job = createMockJob({ experienceLevel: 'SENIOR' });
    const score = DeterministicMatchService.matchExperience(5, job);
    assert.ok(score >= 85, `Expected score >= 85, got ${score}`);
  });

  test('does not heavily penalize candidate exceeding minimum experience', () => {
    // 8 years candidate vs MID (2-5 years)
    const job = createMockJob({ experienceLevel: 'MID' });
    const score = DeterministicMatchService.matchExperience(8, job);
    assert.ok(score >= 80, `Expected score >= 80 for overqualified, got ${score}`);
  });

  test('returns lower score when candidate is significantly below required experience', () => {
    // 1 year candidate vs LEAD (7-10 years)
    const job = createMockJob({ experienceLevel: 'LEAD' });
    const score = DeterministicMatchService.matchExperience(1, job);
    assert.ok(score <= 50, `Expected score <= 50 for under-experienced, got ${score}`);
  });

  test('handles missing candidate experience with neutral score', () => {
    const job = createMockJob({ experienceLevel: 'MID' });
    const score = DeterministicMatchService.matchExperience(null, job);
    assert.equal(score, 65, 'Neutral score expected for missing experience');
  });
});

describe('DeterministicMatchService - Role Matching (C)', () => {
  test('returns high score for identical or highly matching role family', () => {
    const candidate = createMockCandidate({
      currentTitle: 'Lead Software Architect',
    });
    const job = createMockJob({
      title: 'Senior Backend Engineer',
    });

    const { score, candidateFamily, jobFamily } = DeterministicMatchService.matchRole(candidate, job);
    assert.equal(candidateFamily, 'ENGINEERING');
    assert.equal(jobFamily, 'ENGINEERING');
    assert.ok(score >= 85, `Expected score >= 85, got ${score}`);
  });

  test('returns moderate score for related role families (e.g. Product vs Project Management)', () => {
    const candidate = createMockCandidate({
      currentTitle: 'Technical Product Owner',
      jobPreferences: {
        preferredRoles: ['Product Manager'],
        preferredLocations: [],
        workModes: [],
        preferredIndustries: [],
        minimumSalary: null,
        salaryCurrency: null,
      },
    });
    const job = createMockJob({
      title: 'Project Manager - Agile Delivery',
    });

    const { score, candidateFamily, jobFamily } = DeterministicMatchService.matchRole(candidate, job);
    assert.equal(candidateFamily, 'PRODUCT');
    assert.equal(jobFamily, 'PROJECT_MANAGEMENT');
    assert.ok(score >= 50 && score <= 75, `Expected score between 50 and 75, got ${score}`);
  });

  test('returns low score for unrelated role families (e.g. Design vs Engineering)', () => {
    const candidate = createMockCandidate({
      currentTitle: 'UI/UX Visual Designer',
      jobPreferences: null,
    });
    const job = createMockJob({
      title: 'DevOps / Site Reliability Engineer',
    });

    const { score, candidateFamily, jobFamily } = DeterministicMatchService.matchRole(candidate, job);
    assert.equal(candidateFamily, 'DESIGN');
    assert.equal(jobFamily, 'DEVOPS');
    assert.ok(score <= 40, `Expected low score <= 40 for unrelated roles, got ${score}`);
  });
});

describe('DeterministicMatchService - Preference Matching (D)', () => {
  test('awards high score for matching remote work mode and preferred location', () => {
    const candidate = createMockCandidate({
      jobPreferences: {
        preferredRoles: [],
        preferredLocations: ['Coimbatore TN'],
        workModes: ['REMOTE'],
        preferredIndustries: ['Technology'],
        minimumSalary: 110000,
        salaryCurrency: 'USD',
      },
    });
    const job = createMockJob({
      workMode: 'REMOTE',
      location: 'Coimbatore, Tamil Nadu',
      salaryMin: 120000,
      salaryCurrency: 'USD',
    });

    const locationScore = DeterministicMatchService.matchLocationAndWorkMode(candidate, job);
    const prefScore = DeterministicMatchService.matchPreferences(candidate, job);

    assert.ok(locationScore >= 90, `Expected locationScore >= 90, got ${locationScore}`);
    assert.ok(prefScore >= 80, `Expected prefScore >= 80, got ${prefScore}`);
  });

  test('handles hybrid work mode compatibility', () => {
    const candidate = createMockCandidate({
      jobPreferences: {
        preferredRoles: [],
        preferredLocations: ['Coimbatore'],
        workModes: ['HYBRID', 'REMOTE'],
        preferredIndustries: [],
        minimumSalary: null,
        salaryCurrency: null,
      },
    });
    const job = createMockJob({
      workMode: 'HYBRID',
      location: 'Coimbatore',
    });

    const score = DeterministicMatchService.matchLocationAndWorkMode(candidate, job);
    assert.ok(score >= 85, `Expected high score for hybrid match, got ${score}`);
  });

  test('penalizes when job salary is strictly below candidate minimum salary', () => {
    const candidate = createMockCandidate({
      jobPreferences: {
        preferredRoles: [],
        preferredLocations: [],
        workModes: [],
        preferredIndustries: [],
        minimumSalary: 150000,
        salaryCurrency: 'USD',
      },
    });
    const job = createMockJob({
      salaryMin: 80000,
      salaryMax: 100000,
      salaryCurrency: 'USD',
    });

    const score = DeterministicMatchService.matchPreferences(candidate, job);
    assert.ok(score <= 50, `Expected penalty for lower salary, got ${score}`);
  });

  test('returns neutral score when candidate has no preferences defined', () => {
    const candidate = createMockCandidate({ jobPreferences: null });
    const job = createMockJob();

    const score = DeterministicMatchService.matchPreferences(candidate, job);
    assert.equal(score, 70, 'Should return neutral score 70 when no preferences exist');
  });
});
