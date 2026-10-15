import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApplicationValidationService,
  UnsupportedClaimError,
} from './application-validation.service.js';
import type {
  VerifiedCandidateProfileInput,
  TargetJobInput,
} from '../ai/prompts/application-generation.user.js';

describe('ApplicationValidationService - Anti-Hallucination & Fact Validation', () => {
  const validator = new ApplicationValidationService();

  const mockCandidate: VerifiedCandidateProfileInput = {
    fullName: 'Jane Doe',
    currentTitle: 'Senior Backend Engineer',
    yearsOfExperience: 5,
    professionalSummary: 'Experienced software engineer focused on Node.js and TypeScript microservices.',
    skills: [
      { name: 'TypeScript', category: 'Language' },
      { name: 'Node.js', category: 'Backend' },
      { name: 'PostgreSQL', category: 'Database' },
      { name: 'Docker', category: 'DevOps' },
    ],
    experience: [
      {
        company: 'Innovatech Solutions',
        jobTitle: 'Senior Software Engineer',
        startDate: '2021',
        endDate: null,
        description: 'Led architecture of cloud microservices.',
      },
      {
        company: 'StartupLab',
        jobTitle: 'Software Engineer',
        startDate: '2019',
        endDate: '2021',
        description: 'Built REST APIs and database models.',
      },
    ],
    education: [
      {
        institution: 'University of Technology',
        degree: 'Bachelor of Science in Computer Science',
      },
    ],
  };

  const mockJob: TargetJobInput = {
    title: 'Staff Backend Engineer',
    company: 'NextGen Cloud',
    description: 'Looking for a Staff Backend Engineer with 5+ years of experience in Node.js and distributed systems.',
  };

  test('validates clean, grounded cover letter without warnings or suspicious claims', () => {
    const cleanContent = `
Dear Hiring Team at NextGen Cloud,

I am writing to express my strong interest in the Staff Backend Engineer position. With 5 years of experience architecting distributed backend services at Innovatech Solutions and StartupLab, I have honed deep expertise in Node.js, TypeScript, and PostgreSQL.

At Innovatech Solutions, I spearheaded our transition to cloud microservices and optimized PostgreSQL database queries for peak throughput. My academic background with a Bachelor of Science in Computer Science from University of Technology gives me a rigorous foundation in system design.

Thank you for your consideration.
    `.trim();

    const result = validator.validateContent(mockCandidate, mockJob, cleanContent);

    assert.equal(result.isValid, true);
    assert.equal(result.suspiciousClaims.length, 0);
  });

  test('detects exaggerated years of experience', () => {
    const exaggeratedContent = `
I bring over 12 years of experience in backend development to the NextGen Cloud team.
    `.trim();

    const result = validator.validateContent(mockCandidate, mockJob, exaggeratedContent);

    assert.equal(result.isValid, false);
    assert.equal(result.suspiciousClaims.length, 1);
    assert.match(result.suspiciousClaims[0], /Claimed 12\+ years of experience/);
  });

  test('detects unverified past employer claims', () => {
    const hallucinatedEmployerContent = `
While at Netflix, I designed distributed stream processing pipelines that scaled to millions of concurrent viewers.
    `.trim();

    const result = validator.validateContent(mockCandidate, mockJob, hallucinatedEmployerContent);

    assert.equal(result.isValid, false);
    assert.ok(result.suspiciousClaims.length >= 1);
    assert.match(result.suspiciousClaims[0], /Netflix/);
  });

  test('detects unverified certifications', () => {
    const hallucinatedCertContent = `
As an AWS Certified Solutions Architect and CISSP credential holder, I guarantee secure cloud deployments.
    `.trim();

    const result = validator.validateContent(mockCandidate, mockJob, hallucinatedCertContent);

    assert.equal(result.isValid, false);
    assert.ok(
      result.suspiciousClaims.some((c) => c.includes('AWS Certified Solutions Architect'))
    );
    assert.ok(result.suspiciousClaims.some((c) => c.includes('CISSP')));
  });

  test('validateApplicationMaterials checks coverLetter, resumeBullets, and summary collectively', () => {
    const materials = {
      coverLetter: 'I have 5 years experience at Innovatech Solutions.',
      resumeBullets: [
        { bullet: 'Built Node.js microservices handling 50k req/sec.' },
        { bullet: 'Led architecture while at Google for global load balancing.' },
      ],
      summary: 'Candidate with 14 years of experience.',
    };

    const result = validator.validateApplicationMaterials(mockCandidate, mockJob, materials);

    assert.equal(result.isValid, false);
    assert.ok(result.suspiciousClaims.some((c) => c.includes('Google')));
    assert.ok(result.suspiciousClaims.some((c) => c.includes('14+ years')));
  });
});
