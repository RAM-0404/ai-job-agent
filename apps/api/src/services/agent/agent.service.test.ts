import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AgentService } from './agent.service.js';
import { prisma } from '../../db/prisma.js';
import {
  AgentActionNotAllowedError,
  AgentContextNotFoundError,
  InvalidAgentStateTransitionError,
} from './agent.errors.js';
import type { JobMatchResponse, MatchRecommendation } from '@ai-job-agent/shared';
import type { ApplicationServiceDependencies } from './nodes/application-generation.node.js';
import type { ApplicationValidationDependencies } from './nodes/application-validation.node.js';

describe('AgentService - Orchestration, M7 Matching & M8 Application Integration (M9.3)', () => {
  let defaultAgentService: AgentService;
  let testProfileId: string;
  let testSourceId: string;
  let testJobId: string;
  let createdRunIds: string[] = [];

  // Helper mock match service factory
  function createMockMatchService(
    score: number,
    recommendation: MatchRecommendation,
    shouldThrow = false
  ) {
    return {
      async matchJob(jobId: string, userProfileId?: string): Promise<JobMatchResponse> {
        if (shouldThrow) {
          throw new Error('M7 Matching Connection Timeout');
        }

        // Also persist/upsert JobMatch record to simulate actual M7 behavior
        if (userProfileId) {
          await prisma.jobMatch.upsert({
            where: {
              jobId_userProfileId: {
                jobId,
                userProfileId,
              },
            },
            create: {
              jobId,
              userProfileId,
              overallScore: score,
              skillScore: score,
              experienceScore: score,
              roleScore: score,
              preferenceScore: score,
              locationScore: score,
              recommendation,
              strengths: ['Mock strength'],
              gaps: [],
            },
            update: {
              overallScore: score,
              recommendation,
            },
          });
        }

        return {
          id: 'mock-match-id',
          jobId,
          overallScore: score,
          recommendation,
          scores: {
            skill: score,
            experience: score,
            role: score,
            preference: score,
            location: score,
          },
          strengths: ['Mock strength'],
          gaps: [],
          explanation: 'Mock matching explanation',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
    };
  }

  // Helper mock application service factory
  function createMockAppService(options: { shouldThrow?: boolean } = {}): ApplicationServiceDependencies {
    return {
      async createOrGetApplication(jobId: string, userProfileId?: string) {
        if (options.shouldThrow) throw new Error('Application generation failed: DB error');
        let app = await prisma.application.findUnique({
          where: { jobId_userProfileId: { jobId, userProfileId: userProfileId! } },
          include: { documents: true, answers: true },
        });
        if (!app) {
          app = await prisma.application.create({
            data: { jobId, userProfileId: userProfileId!, status: 'DRAFT' },
            include: { documents: true, answers: true },
          });
        }
        return { application: app } as any;
      },
      async generateApplicationContent(id: string) {
        if (options.shouldThrow) throw new Error('Application generation failed: Ollama timeout');
        await prisma.applicationDocument.upsert({
          where: { applicationId_type: { applicationId: id, type: 'COVER_LETTER' } },
          create: { applicationId: id, type: 'COVER_LETTER', content: 'Dear Hiring Team, I am excited to apply.', source: 'AI_GENERATED' },
          update: { content: 'Dear Hiring Team, I am excited to apply.', source: 'AI_GENERATED' },
        });
        await prisma.applicationDocument.upsert({
          where: { applicationId_type: { applicationId: id, type: 'RESUME_BULLETS' } },
          create: { applicationId: id, type: 'RESUME_BULLETS', content: '- Built scalable cloud platforms\n- Mentored engineers', source: 'AI_GENERATED' },
          update: { content: '- Built scalable cloud platforms\n- Mentored engineers', source: 'AI_GENERATED' },
        });
        await prisma.applicationDocument.upsert({
          where: { applicationId_type: { applicationId: id, type: 'APPLICATION_SUMMARY' } },
          create: { applicationId: id, type: 'APPLICATION_SUMMARY', content: 'Senior systems engineer with strong background.', source: 'AI_GENERATED' },
          update: { content: 'Senior systems engineer with strong background.', source: 'AI_GENERATED' },
        });
        return {} as any;
      },
      async getApplicationWorkspace(id: string) {
        return {} as any;
      },
    };
  }

  // Helper mock validation service factory
  function createMockValidationService(options: {
    isValid?: boolean;
    warnings?: string[];
    suspiciousClaims?: string[];
    shouldThrow?: boolean;
  } = {}): ApplicationValidationDependencies {
    return {
      validateApplicationMaterials() {
        if (options.shouldThrow) throw new Error('Validation service encountered internal error');
        return {
          isValid: options.isValid ?? (options.suspiciousClaims ? options.suspiciousClaims.length === 0 : true),
          warnings: options.warnings || [],
          suspiciousClaims: options.suspiciousClaims || [],
        };
      },
    };
  }

  before(async () => {
    defaultAgentService = new AgentService();

    // 1. Create candidate profile
    const profile = await prisma.userProfile.create({
      data: {
        fullName: 'Agent M9.3 Test Candidate',
        email: `agent-m93-${Date.now()}@example.com`,
        currentTitle: 'Lead Distributed Systems Engineer',
        yearsOfExperience: 9,
        skills: {
          create: [
            { name: 'TypeScript', category: 'Language' },
            { name: 'Node.js', category: 'Backend' },
          ],
        },
      },
    });
    testProfileId = profile.id;

    // 2. Create job source and job
    const source = await prisma.jobSource.create({
      data: {
        name: `Agent M9.3 Source ${Date.now()}`,
        type: 'MANUAL',
      },
    });
    testSourceId = source.id;

    const job = await prisma.job.create({
      data: {
        jobSourceId: testSourceId,
        title: 'Lead Orchestration Engineer',
        companyName: 'Graph Architecture Corp',
        description: 'Orchestrating stateful agent workflows using LangGraph.',
        workMode: 'REMOTE',
        employmentType: 'FULL_TIME',
        experienceLevel: 'LEAD',
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
  });

  test('createRun initializes agent run in IDLE state with INITIALIZE event', async () => {
    const run = await defaultAgentService.createRun({
      userProfileId: testProfileId,
      jobId: testJobId,
    });
    createdRunIds.push(run.id);

    assert.ok(run.id);
    assert.equal(run.status, 'IDLE');
    assert.equal(run.currentStep, 'INITIALIZE');
    assert.equal(run.userProfileId, testProfileId);
    assert.equal(run.jobId, testJobId);
    assert.equal(run.decision, null);

    const events = await defaultAgentService.getRunEvents(run.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].step, 'INITIALIZE');
    assert.equal(events[0].eventType, 'CREATED');
  });

  test('A. APPLY path: triggers generation, validation, and halts at HUMAN_REVIEW', async () => {
    const mockMatch = createMockMatchService(92, 'APPLY');
    const mockApp = createMockAppService();
    const mockVal = createMockValidationService({ isValid: true, warnings: [] });
    const service = new AgentService(mockMatch, mockApp, mockVal);

    const run = await service.createRun({
      userProfileId: testProfileId,
      jobId: testJobId,
    });
    createdRunIds.push(run.id);

    const startedRun = await service.startRun(run.id);

    // Verify state machine values
    assert.equal(startedRun.status, 'WAITING_FOR_HUMAN');
    assert.equal(startedRun.currentStep, 'HUMAN_REVIEW');
    assert.equal(startedRun.decision, 'WAIT_FOR_HUMAN');
    assert.equal(startedRun.matchScore, 92);
    assert.equal(startedRun.matchRecommendation, 'APPLY');
    assert.ok(startedRun.applicationId);
    assert.equal(startedRun.applicationGenerated, true);
    assert.equal(startedRun.applicationValidated, true);
    assert.equal(startedRun.validationPassed, true);
    assert.equal(startedRun.completedAt, null);

    // Verify Application record was created and documents exist
    const app = await prisma.application.findUnique({
      where: { id: startedRun.applicationId! },
      include: { documents: true },
    });
    assert.ok(app);
    assert.equal(app.status, 'DRAFT'); // Crucial: Agent does NOT approve application itself
    assert.equal(app.documents.length, 3);

    // Verify chronological event sequence
    const events = await service.getRunEvents(run.id);
    const eventTags = events.map((e) => `${e.step}:${e.eventType}`);

    assert.deepEqual(eventTags, [
      'INITIALIZE:CREATED',
      'LOAD_CONTEXT:STARTED',
      'LOAD_CONTEXT:COMPLETED',
      'EVALUATE:EVALUATION_STARTED',
      'EVALUATE:MATCH_STARTED',
      'EVALUATE:MATCH_COMPLETED',
      'EVALUATE:AGENT_CONTINUED',
      'GENERATE_APPLICATION:APPLICATION_GENERATION:STARTED',
      'GENERATE_APPLICATION:APPLICATION_GENERATION:COMPLETED',
      'VALIDATE_APPLICATION:APPLICATION_VALIDATION:STARTED',
      'VALIDATE_APPLICATION:APPLICATION_VALIDATION:PASSED',
      'HUMAN_REVIEW:WAITING',
    ]);
  });

  test('B. CONSIDER path: generates application and proceeds to human review', async () => {
    const mockMatch = createMockMatchService(74, 'CONSIDER');
    const mockApp = createMockAppService();
    const mockVal = createMockValidationService({ isValid: true, warnings: [] });
    const service = new AgentService(mockMatch, mockApp, mockVal);

    const run = await service.createRun({
      userProfileId: testProfileId,
      jobId: testJobId,
    });
    createdRunIds.push(run.id);

    const startedRun = await service.startRun(run.id);

    assert.equal(startedRun.status, 'WAITING_FOR_HUMAN');
    assert.equal(startedRun.currentStep, 'HUMAN_REVIEW');
    assert.equal(startedRun.decision, 'WAIT_FOR_HUMAN');
    assert.equal(startedRun.matchScore, 74);
    assert.equal(startedRun.matchRecommendation, 'CONSIDER');
    assert.ok(startedRun.applicationId);
  });

  test('C. LOW_PRIORITY recommendation: stops without generating application', async () => {
    const mockMatch = createMockMatchService(64, 'LOW_PRIORITY');
    const mockApp = createMockAppService();
    const service = new AgentService(mockMatch, mockApp);

    // Initial application count
    const initialAppsCount = await prisma.application.count({
      where: { jobId: testJobId, userProfileId: testProfileId },
    });

    const run = await service.createRun({
      userProfileId: testProfileId,
      jobId: testJobId,
    });
    createdRunIds.push(run.id);

    const stoppedRun = await service.startRun(run.id);

    // Terminated safely through stop path
    assert.equal(stoppedRun.status, 'COMPLETED');
    assert.equal(stoppedRun.currentStep, 'COMPLETED');
    assert.equal(stoppedRun.decision, 'STOP');
    assert.equal(stoppedRun.matchScore, 64);
    assert.equal(stoppedRun.matchRecommendation, 'LOW_PRIORITY');
    assert.ok(stoppedRun.completedAt);

    // Verify application count remained unchanged
    const afterAppsCount = await prisma.application.count({
      where: { jobId: testJobId, userProfileId: testProfileId },
    });
    assert.equal(afterAppsCount, initialAppsCount);

    // Verify chronological event sequence for stop path (NO application events)
    const events = await service.getRunEvents(run.id);
    const eventTags = events.map((e) => `${e.step}:${e.eventType}`);

    assert.deepEqual(eventTags, [
      'INITIALIZE:CREATED',
      'LOAD_CONTEXT:STARTED',
      'LOAD_CONTEXT:COMPLETED',
      'EVALUATE:EVALUATION_STARTED',
      'EVALUATE:MATCH_STARTED',
      'EVALUATE:MATCH_COMPLETED',
      'EVALUATE:AGENT_STOPPED',
      'COMPLETED:COMPLETED',
    ]);
  });

  test('D. DO_NOT_APPLY recommendation: stops without generating application', async () => {
    const mockMatch = createMockMatchService(35, 'DO_NOT_APPLY');
    const mockApp = createMockAppService();
    const service = new AgentService(mockMatch, mockApp);

    const run = await service.createRun({
      userProfileId: testProfileId,
      jobId: testJobId,
    });
    createdRunIds.push(run.id);

    const stoppedRun = await service.startRun(run.id);

    assert.equal(stoppedRun.status, 'COMPLETED');
    assert.equal(stoppedRun.currentStep, 'COMPLETED');
    assert.equal(stoppedRun.decision, 'STOP');
    assert.equal(stoppedRun.matchScore, 35);
    assert.equal(stoppedRun.matchRecommendation, 'DO_NOT_APPLY');
    assert.ok(stoppedRun.completedAt);
  });

  test('E. Application generation failure: halts in FAILED state without human review', async () => {
    const mockMatch = createMockMatchService(90, 'APPLY');
    const mockApp = createMockAppService({ shouldThrow: true });
    const service = new AgentService(mockMatch, mockApp);

    const run = await service.createRun({
      userProfileId: testProfileId,
      jobId: testJobId,
    });
    createdRunIds.push(run.id);

    const failedRun = await service.startRun(run.id);

    assert.equal(failedRun.status, 'FAILED');
    assert.equal(failedRun.currentStep, 'FAILED');
    assert.equal(failedRun.decision, 'STOP');
    assert.match(failedRun.errorMessage || '', /Application generation failed/);

    const events = await service.getRunEvents(run.id);
    const eventTypes = events.map((e) => e.eventType);

    assert.ok(eventTypes.includes('APPLICATION_GENERATION:FAILED'));
    assert.ok(!eventTypes.includes('APPLICATION_VALIDATION:STARTED'));
    assert.ok(!eventTypes.includes('WAITING'));
  });

  test('F. Validation hard failure: halts in FAILED state when unsupported claims detected', async () => {
    const mockMatch = createMockMatchService(90, 'APPLY');
    const mockApp = createMockAppService();
    const mockVal = createMockValidationService({
      isValid: false,
      suspiciousClaims: ['Claimed 15 years experience, but profile only has 9 years'],
    });
    const service = new AgentService(mockMatch, mockApp, mockVal);

    const run = await service.createRun({
      userProfileId: testProfileId,
      jobId: testJobId,
    });
    createdRunIds.push(run.id);

    const failedRun = await service.startRun(run.id);

    assert.equal(failedRun.status, 'FAILED');
    assert.equal(failedRun.currentStep, 'FAILED');
    assert.equal(failedRun.decision, 'STOP');

    const events = await service.getRunEvents(run.id);
    const eventTypes = events.map((e) => e.eventType);

    assert.ok(eventTypes.includes('APPLICATION_VALIDATION:FAILED'));
    assert.ok(!eventTypes.includes('WAITING'));
  });

  test('G. Validation reviewable warnings: preserves warnings and proceeds to HUMAN_REVIEW', async () => {
    const mockMatch = createMockMatchService(85, 'APPLY');
    const mockApp = createMockAppService();
    const mockVal = createMockValidationService({
      isValid: true,
      warnings: ['Contains specific quantitative metric not explicitly found in verified profile.'],
    });
    const service = new AgentService(mockMatch, mockApp, mockVal);

    const run = await service.createRun({
      userProfileId: testProfileId,
      jobId: testJobId,
    });
    createdRunIds.push(run.id);

    const waitingRun = await service.startRun(run.id);

    assert.equal(waitingRun.status, 'WAITING_FOR_HUMAN');
    assert.equal(waitingRun.currentStep, 'HUMAN_REVIEW');
    assert.equal(waitingRun.validationPassed, true);

    const events = await service.getRunEvents(run.id);
    const warnEv = events.find((e) => e.eventType === 'APPLICATION_VALIDATION:WARNINGS');
    assert.ok(warnEv);
    assert.match(warnEv.message, /quantitative metric/);
  });

  test('H. Existing application idempotency: running twice for same candidate/job reuses record', async () => {
    const mockMatch = createMockMatchService(88, 'APPLY');
    const mockApp = createMockAppService();
    const service = new AgentService(mockMatch, mockApp);

    // First agent run
    const run1 = await service.createRun({
      userProfileId: testProfileId,
      jobId: testJobId,
    });
    createdRunIds.push(run1.id);
    const started1 = await service.startRun(run1.id);

    const initialAppCount = await prisma.application.count({
      where: { jobId: testJobId, userProfileId: testProfileId },
    });
    assert.equal(initialAppCount, 1);

    // Second agent run for same candidate & job
    const run2 = await service.createRun({
      userProfileId: testProfileId,
      jobId: testJobId,
    });
    createdRunIds.push(run2.id);
    const started2 = await service.startRun(run2.id);

    const afterAppCount = await prisma.application.count({
      where: { jobId: testJobId, userProfileId: testProfileId },
    });
    assert.equal(afterAppCount, 1, 'Application record must be reused idempotently without duplication');
    assert.equal(started2.applicationId, started1.applicationId);
  });

  test('I. User-edited content protection: never overwrites USER_EDITED application content', async () => {
    const mockMatch = createMockMatchService(88, 'APPLY');
    const mockApp = createMockAppService();
    const service = new AgentService(mockMatch, mockApp);

    // 1. First run generates application
    const run1 = await service.createRun({
      userProfileId: testProfileId,
      jobId: testJobId,
    });
    createdRunIds.push(run1.id);
    const started1 = await service.startRun(run1.id);

    // 2. Candidate manually edits cover letter
    const userEditedText = 'HAND-CRAFTED COVER LETTER BY CANDIDATE';
    await prisma.applicationDocument.update({
      where: {
        applicationId_type: {
          applicationId: started1.applicationId!,
          type: 'COVER_LETTER',
        },
      },
      data: {
        content: userEditedText,
        source: 'USER_EDITED',
      },
    });

    // 3. Second agent run executes for same candidate/job
    const run2 = await service.createRun({
      userProfileId: testProfileId,
      jobId: testJobId,
    });
    createdRunIds.push(run2.id);
    await service.startRun(run2.id);

    // 4. Verify candidate's edits are fully intact
    const docAfter = await prisma.applicationDocument.findUnique({
      where: {
        applicationId_type: {
          applicationId: started1.applicationId!,
          type: 'COVER_LETTER',
        },
      },
    });

    assert.equal(docAfter?.content, userEditedText);
    assert.equal(docAfter?.source, 'USER_EDITED');

    // Verify event explicitly logged preservation of manual edits
    const events2 = await service.getRunEvents(run2.id);
    const compEv = events2.find(
      (e) => e.step === 'GENERATE_APPLICATION' && e.eventType === 'APPLICATION_GENERATION:COMPLETED'
    );
    assert.match(compEv?.message || '', /manual edits preserved/);
  });

  test('J. Human approval: approves workflow from WAITING_FOR_HUMAN and completes run', async () => {
    const mockMatch = createMockMatchService(85, 'APPLY');
    const mockApp = createMockAppService();
    const service = new AgentService(mockMatch, mockApp);

    const run = await service.createRun({
      userProfileId: testProfileId,
      jobId: testJobId,
    });
    createdRunIds.push(run.id);

    await service.startRun(run.id);

    // Human approves
    const approved = await service.approveRun(run.id);

    assert.equal(approved.status, 'COMPLETED');
    assert.equal(approved.currentStep, 'COMPLETED');
    assert.equal(approved.decision, 'APPROVED');
    assert.ok(approved.completedAt);

    const events = await service.getRunEvents(run.id);
    const lastEvent = events[events.length - 1];
    assert.equal(lastEvent.step, 'COMPLETED');
    assert.equal(lastEvent.eventType, 'COMPLETED');
  });

  test('K. Human rejection: safely terminates workflow to CANCELLED', async () => {
    const mockMatch = createMockMatchService(85, 'APPLY');
    const mockApp = createMockAppService();
    const service = new AgentService(mockMatch, mockApp);

    const run = await service.createRun({
      userProfileId: testProfileId,
      jobId: testJobId,
    });
    createdRunIds.push(run.id);

    await service.startRun(run.id);

    const rejected = await service.rejectRun(run.id, 'Candidate decided not to pursue this position.');

    assert.equal(rejected.status, 'CANCELLED');
    assert.equal(rejected.currentStep, 'HUMAN_REVIEW');
    assert.equal(rejected.decision, 'REJECTED');
    assert.equal(rejected.errorMessage, 'Candidate decided not to pursue this position.');

    const events = await service.getRunEvents(run.id);
    const lastEvent = events[events.length - 1];
    assert.equal(lastEvent.step, 'HUMAN_REVIEW');
    assert.equal(lastEvent.eventType, 'REJECTED');
  });

  test('enforces strict transition rules and blocks invalid transitions', async () => {
    const run = await defaultAgentService.createRun({
      userProfileId: testProfileId,
      jobId: testJobId,
    });
    createdRunIds.push(run.id);

    // Approval fails while IDLE
    await assert.rejects(
      async () => {
        await defaultAgentService.approveRun(run.id);
      },
      AgentActionNotAllowedError
    );

    // Rejection fails while IDLE
    await assert.rejects(
      async () => {
        await defaultAgentService.rejectRun(run.id);
      },
      AgentActionNotAllowedError
    );
  });

  test('fails safely when context is missing', async () => {
    const fakeJobId = '00000000-0000-0000-0000-000000000000';

    await assert.rejects(
      async () => {
        await defaultAgentService.createRun({
          userProfileId: testProfileId,
          jobId: fakeJobId,
        });
      },
      AgentContextNotFoundError
    );
  });
});
