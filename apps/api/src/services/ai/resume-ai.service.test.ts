import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../db/prisma.js';
import {
  ResumeAIService,
  ResumeNoTextError,
  ResumeTextTooLargeError,
  AIOutputValidationError,
  parseDateString,
} from './resume-ai.service.js';
import { OllamaService } from './ollama.service.js';
import type { ValidatedResumeAIProfile } from './schema/resume-ai.schema.js';

describe('ResumeAIService', () => {
  let testProfileId: string;
  let testResumeId: string;
  const initialRawText = 'Senior Full Stack Engineer with 7 years of experience in TypeScript and React.';

  before(async () => {
    // Create test user profile and resume record
    const profile = await prisma.userProfile.create({
      data: {
        fullName: 'AI Test User',
        email: `ai-test-${Date.now()}@example.com`,
      },
    });
    testProfileId = profile.id;

    const resume = await prisma.resume.create({
      data: {
        userProfileId: testProfileId,
        fileName: 'test-resume.pdf',
        filePath: '/mock/path/test-resume.pdf',
        fileType: 'application/pdf',
        fileSize: 1024,
        rawText: initialRawText,
        version: 1,
      },
    });
    testResumeId = resume.id;
  });

  after(async () => {
    if (testProfileId) {
      await prisma.userProfile.delete({
        where: { id: testProfileId },
      });
    }
  });

  describe('Date Parsing Helper', () => {
    test('parses YYYY format', () => {
      const d = parseDateString('2021');
      assert.ok(d);
      assert.equal(d?.getUTCFullYear(), 2021);
      assert.equal(d?.getUTCMonth(), 0);
    });

    test('parses YYYY-MM format', () => {
      const d = parseDateString('2022-06');
      assert.ok(d);
      assert.equal(d?.getUTCFullYear(), 2022);
      assert.equal(d?.getUTCMonth(), 5);
    });

    test('returns null for present/current/null values', () => {
      assert.equal(parseDateString(null), null);
      assert.equal(parseDateString(''), null);
      assert.equal(parseDateString('Present'), null);
      assert.equal(parseDateString('current'), null);
      assert.equal(parseDateString('now'), null);
    });
  });

  describe('AI Extraction and Validation', () => {
    test('throws ResumeNoTextError when rawText is null or empty', async () => {
      const service = new ResumeAIService({} as any);

      await assert.rejects(
        async () => {
          await service.extractProfileFromText(null);
        },
        (err: Error) => {
          assert(err instanceof ResumeNoTextError);
          assert.match(err.message, /no extracted plain text/);
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await service.extractProfileFromText('   ');
        },
        (err: Error) => {
          assert(err instanceof ResumeNoTextError);
          return true;
        }
      );
    });

    test('throws ResumeTextTooLargeError when rawText exceeds maximum limit', async () => {
      const service = new ResumeAIService({} as any);
      const hugeText = 'A'.repeat(30001);

      await assert.rejects(
        async () => {
          await service.extractProfileFromText(hugeText);
        },
        (err: Error) => {
          assert(err instanceof ResumeTextTooLargeError);
          assert.match(err.message, /exceeds the maximum allowed limit/);
          return true;
        }
      );
    });

    test('validates and returns typed structured profile from mock Ollama client', async () => {
      const mockProfile: ValidatedResumeAIProfile = {
        professionalSummary: 'Experienced software engineer specializing in scalable systems.',
        currentTitle: 'Lead Software Architect',
        yearsOfExperience: 8,
        skills: [
          { name: 'TypeScript', category: 'Languages', proficiency: 'Expert' },
          { name: 'React', category: 'Frontend', proficiency: 'Advanced' },
          { name: 'PostgreSQL', category: 'Databases', proficiency: null },
        ],
        experience: [
          {
            company: 'Tech Corp',
            jobTitle: 'Senior Engineer',
            startDate: '2020-01',
            endDate: null,
            isCurrent: true,
            description: 'Built high throughput event pipeline',
          },
        ],
        education: [
          {
            institution: 'University of Science',
            degree: 'Bachelor of Science',
            fieldOfStudy: 'Computer Science',
            startDate: '2014',
            endDate: '2018',
            description: 'Magna cum laude',
          },
        ],
        projects: [
          {
            name: 'Job Matching Agent',
            description: 'AI platform for matching candidates',
            technologies: ['TypeScript', 'Fastify', 'Docker'],
          },
        ],
        certifications: [
          {
            name: 'AWS Solutions Architect',
            issuer: 'Amazon Web Services',
            year: 2022,
          },
        ],
      };

      const mockOllama = {
        generateStructured: async () => mockProfile,
      } as unknown as OllamaService;

      const service = new ResumeAIService(mockOllama);
      const result = await service.extractProfileFromText(initialRawText);

      assert.equal(result.currentTitle, 'Lead Software Architect');
      assert.equal(result.yearsOfExperience, 8);
      assert.equal(result.skills.length, 3);
      assert.equal(result.experience.length, 1);
      assert.equal(result.education.length, 1);
      assert.equal(result.projects.length, 1);
      assert.equal(result.certifications.length, 1);
    });

    test('throws AIOutputValidationError when LLM returns invalid schema structure', async () => {
      const invalidMockProfile = {
        professionalSummary: 'Engineer',
        skills: 'Invalid: should be an array of objects',
      };

      const mockOllama = {
        generateStructured: async () => invalidMockProfile,
      } as unknown as OllamaService;

      const service = new ResumeAIService(mockOllama);
      await assert.rejects(
        async () => {
          await service.extractProfileFromText(initialRawText);
        },
        (err: Error) => {
          assert(err instanceof AIOutputValidationError);
          assert.match(err.message, /schema validation/);
          return true;
        }
      );
    });
  });

  describe('PostgreSQL Database Persistence & Duplicate Prevention', () => {
    const aiData: ValidatedResumeAIProfile = {
      professionalSummary: 'Senior Full Stack Specialist with AI expertise.',
      currentTitle: 'Staff Software Engineer',
      yearsOfExperience: 9,
      skills: [
        { name: 'TypeScript', category: 'Language', proficiency: 'Expert' },
        { name: 'React', category: 'Frontend', proficiency: 'Advanced' },
        { name: 'Node.js', category: 'Backend', proficiency: 'Expert' },
      ],
      experience: [
        {
          company: 'Acme Global',
          jobTitle: 'Senior Developer',
          startDate: '2021-01',
          endDate: null,
          isCurrent: true,
          description: 'Leading platform engineering team',
        },
      ],
      education: [
        {
          institution: 'State University',
          degree: 'Master of Science',
          fieldOfStudy: 'Software Engineering',
          startDate: '2019-09',
          endDate: '2021-06',
          description: 'Specialization in Distributed Systems',
        },
      ],
      projects: [
        {
          name: 'AI Agent Portal',
          description: 'Multi-agent orchestration system',
          technologies: ['React', 'Fastify', 'Docker'],
        },
      ],
      certifications: [
        {
          name: 'CKA Certified Kubernetes Administrator',
          issuer: 'Linux Foundation',
          year: 2023,
        },
      ],
    };

    test('persists normalized AI data into UserProfile, Skill, Experience, and Education', async () => {
      const service = new ResumeAIService({} as any);

      const response = await service.persistAnalysisData(testProfileId, testResumeId, aiData);

      assert.equal(response.status, 'analyzed');
      assert.equal(response.resumeId, testResumeId);
      assert.equal(response.profile.currentTitle, 'Staff Software Engineer');
      assert.equal(response.profile.yearsOfExperience, 9);
      assert.equal(response.counts.skills, 3);
      assert.equal(response.counts.experience, 1);
      assert.equal(response.counts.education, 1);
      assert.equal(response.counts.projects, 1);
      assert.equal(response.counts.certifications, 1);

      // Verify UserProfile record
      const updatedProfile = await prisma.userProfile.findUnique({
        where: { id: testProfileId },
      });
      assert.equal(updatedProfile?.currentTitle, 'Staff Software Engineer');
      assert.equal(updatedProfile?.yearsOfExperience, 9);
      assert.equal(updatedProfile?.professionalSummary, aiData.professionalSummary);

      // Verify Skills records
      const skills = await prisma.skill.findMany({
        where: { userProfileId: testProfileId },
      });
      assert.equal(skills.length, 3);

      // Verify Experience records
      const experiences = await prisma.experience.findMany({
        where: { userProfileId: testProfileId },
      });
      assert.equal(experiences.length, 1);
      assert.equal(experiences[0].company, 'Acme Global');
      assert.equal(experiences[0].isCurrent, true);

      // Verify Education records
      const educations = await prisma.education.findMany({
        where: { userProfileId: testProfileId },
      });
      assert.equal(educations.length, 1);
      assert.equal(educations[0].institution, 'State University');

      // Verify original Resume and rawText are NOT modified
      const originalResume = await prisma.resume.findUnique({
        where: { id: testResumeId },
      });
      assert.equal(originalResume?.rawText, initialRawText);
    });

    test('re-analyzing the same resume updates records without creating duplicates', async () => {
      const service = new ResumeAIService({} as any);

      // Analyze a second time with identical data
      await service.persistAnalysisData(testProfileId, testResumeId, aiData);

      // Verify record counts remain exactly the same
      const skillsAfter = await prisma.skill.findMany({
        where: { userProfileId: testProfileId },
      });
      assert.equal(skillsAfter.length, 3, 'Skills count should remain 3 after re-analysis');

      const experiencesAfter = await prisma.experience.findMany({
        where: { userProfileId: testProfileId },
      });
      assert.equal(experiencesAfter.length, 1, 'Experiences count should remain 1 after re-analysis');

      const educationsAfter = await prisma.education.findMany({
        where: { userProfileId: testProfileId },
      });
      assert.equal(educationsAfter.length, 1, 'Educations count should remain 1 after re-analysis');
    });
  });
});
