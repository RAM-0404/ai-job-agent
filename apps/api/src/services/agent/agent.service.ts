import { prisma } from '../../db/prisma.js';
import type {
  AgentRunDto,
  AgentRunEventDto,
  CreateAgentRunRequest,
  AgentStatus,
  AgentStep,
  AgentDecision,
} from '@ai-job-agent/shared';
import {
  AgentRunNotFoundError,
  AgentContextNotFoundError,
  InvalidAgentStateTransitionError,
  AgentActionNotAllowedError,
} from './agent.errors.js';
import {
  buildAgentInitialGraph,
  agentContinuationGraph,
  type AgentGraphDependencies,
} from './agent.graph.js';
import { jobMatchService, type JobMatchService } from '../matching/job-match.service.js';
import { applicationService } from '../applications/application.service.js';
import { applicationValidationService } from '../applications/application-validation.service.js';
import type { ApplicationServiceDependencies } from './nodes/application-generation.node.js';
import type { ApplicationValidationDependencies } from './nodes/application-validation.node.js';
import type { AgentRun, AgentRunEvent } from '@prisma/client';

export class AgentService {
  private initialGraph: ReturnType<typeof buildAgentInitialGraph>;

  constructor(
    private readonly matchService: Pick<JobMatchService, 'matchJob'> = jobMatchService,
    private readonly appService: ApplicationServiceDependencies = applicationService,
    private readonly validationService: ApplicationValidationDependencies = applicationValidationService
  ) {
    this.initialGraph = buildAgentInitialGraph({
      matchService: this.matchService,
      appService: this.appService,
      validationService: this.validationService,
    });
  }

  /**
   * Helper to format Prisma model into typed DTO with optional match recommendation and validation flags
   */
  private mapRunToDto(
    run: AgentRun,
    matchRecommendation?: string | null,
    extraFlags?: {
      applicationGenerated?: boolean;
      applicationValidated?: boolean;
      validationPassed?: boolean;
    }
  ): AgentRunDto {
    return {
      id: run.id,
      userProfileId: run.userProfileId,
      jobId: run.jobId,
      applicationId: run.applicationId,
      status: run.status as AgentStatus,
      currentStep: run.currentStep as AgentStep,
      decision: (run.decision as AgentDecision) || null,
      matchScore: run.matchScore,
      matchRecommendation: matchRecommendation ?? null,
      applicationGenerated: extraFlags?.applicationGenerated ?? (!!run.applicationId),
      applicationValidated: extraFlags?.applicationValidated ?? (!!run.applicationId),
      validationPassed: extraFlags?.validationPassed ?? (!!run.applicationId),
      errorMessage: run.errorMessage,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  /**
   * Helper to format Prisma event model into typed DTO
   */
  private mapEventToDto(event: AgentRunEvent): AgentRunEventDto {
    return {
      id: event.id,
      agentRunId: event.agentRunId,
      step: event.step as AgentStep,
      eventType: event.eventType,
      message: event.message,
      metadata: (event.metadata as Record<string, unknown>) || null,
      createdAt: event.createdAt.toISOString(),
    };
  }

  /**
   * Appends an immutable event to the agent run history
   */
  private async recordEvent(
    agentRunId: string,
    step: AgentStep,
    eventType: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<AgentRunEvent> {
    return prisma.agentRunEvent.create({
      data: {
        agentRunId,
        step,
        eventType,
        message,
        metadata: metadata ? (metadata as any) : undefined,
      },
    });
  }

  /**
   * Resolves the target candidate user profile ID (defaults to active profile if omitted)
   */
  private async resolveCandidateProfileId(providedId?: string): Promise<string> {
    if (providedId) {
      const candidate = await prisma.userProfile.findUnique({ where: { id: providedId } });
      if (!candidate) {
        throw new AgentContextNotFoundError('UserProfile', providedId);
      }
      return candidate.id;
    }

    const activeProfile = await prisma.userProfile.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    if (!activeProfile) {
      throw new AgentContextNotFoundError('UserProfile', 'active profile');
    }
    return activeProfile.id;
  }

  /**
   * Creates a new AgentRun in IDLE state with an INITIALIZE event
   */
  async createRun(input: CreateAgentRunRequest): Promise<AgentRunDto> {
    const userProfileId = await this.resolveCandidateProfileId(input.userProfileId);

    // Verify job if provided
    if (input.jobId) {
      const job = await prisma.job.findUnique({ where: { id: input.jobId } });
      if (!job) {
        throw new AgentContextNotFoundError('Job', input.jobId);
      }
    }

    // Verify application if provided
    if (input.applicationId) {
      const app = await prisma.application.findUnique({ where: { id: input.applicationId } });
      if (!app) {
        throw new AgentContextNotFoundError('Application', input.applicationId);
      }
    }

    const run = await prisma.agentRun.create({
      data: {
        userProfileId,
        jobId: input.jobId || null,
        applicationId: input.applicationId || null,
        status: 'IDLE',
        currentStep: 'INITIALIZE',
        startedAt: new Date(),
      },
    });

    await this.recordEvent(
      run.id,
      'INITIALIZE',
      'CREATED',
      'Agent run initialized in IDLE state.'
    );

    return this.mapRunToDto(run);
  }

  /**
   * Starts the agent workflow using LangGraph
   */
  async startRun(runId: string): Promise<AgentRunDto> {
    const run = await prisma.agentRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new AgentRunNotFoundError(runId);
    }

    // Validate state machine transition: only IDLE -> RUNNING
    if (run.status !== 'IDLE') {
      throw new InvalidAgentStateTransitionError(
        run.status,
        'RUNNING',
        `Agent run "${runId}" cannot be started from status "${run.status}". Runs can only start from IDLE.`
      );
    }

    // Transition to RUNNING
    await prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: 'RUNNING',
        currentStep: 'LOAD_CONTEXT',
      },
    });

    await this.recordEvent(
      runId,
      'LOAD_CONTEXT',
      'STARTED',
      'Agent context loading initiated.'
    );

    // Execute the LangGraph workflow
    const graphState = await this.initialGraph.invoke({
      runId,
      userProfileId: run.userProfileId,
      jobId: run.jobId,
      applicationId: run.applicationId,
      currentStep: 'INITIALIZE',
      status: 'RUNNING',
    });

    const extraFlags = {
      applicationGenerated: graphState.applicationGenerated,
      applicationValidated: graphState.applicationValidated,
      validationPassed: graphState.validationPassed,
    };

    // Handle Graph Execution Outcome
    if (graphState.status === 'FAILED') {
      const errorMsg = graphState.errors.join('; ') || 'Agent execution failed during initial phase.';

      const failedRun = await prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          currentStep: graphState.currentStep || 'FAILED',
          decision: 'STOP',
          errorMessage: errorMsg,
          applicationId: graphState.applicationId || undefined,
          completedAt: new Date(),
        },
      });

      return this.mapRunToDto(failedRun, graphState.matchRecommendation, extraFlags);
    }

    if (graphState.status === 'COMPLETED') {
      // Stopped normally due to LOW_PRIORITY or DO_NOT_APPLY
      const completedRun = await prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: 'COMPLETED',
          currentStep: 'COMPLETED',
          decision: graphState.decision || 'STOP',
          matchScore: graphState.matchScore,
          applicationId: graphState.applicationId || undefined,
          completedAt: new Date(),
        },
      });

      return this.mapRunToDto(completedRun, graphState.matchRecommendation, extraFlags);
    }

    if (graphState.status === 'WAITING_FOR_HUMAN') {
      // Paused at mandatory human review checkpoint
      const waitingRun = await prisma.agentRun.update({
        where: { id: runId },
        data: {
          status: 'WAITING_FOR_HUMAN',
          currentStep: 'HUMAN_REVIEW',
          decision: 'WAIT_FOR_HUMAN',
          matchScore: graphState.matchScore,
          applicationId: graphState.applicationId || undefined,
        },
      });

      return this.mapRunToDto(waitingRun, graphState.matchRecommendation, extraFlags);
    }

    // Default return
    const updated = await prisma.agentRun.findUnique({ where: { id: runId } });
    return this.mapRunToDto(updated!, graphState.matchRecommendation, extraFlags);
  }

  /**
   * Retrieves an AgentRun by ID
   */
  async getRun(runId: string): Promise<AgentRunDto> {
    const run = await prisma.agentRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new AgentRunNotFoundError(runId);
    }

    let matchRecommendation: string | null = null;
    if (run.jobId && run.userProfileId) {
      const match = await prisma.jobMatch.findUnique({
        where: {
          jobId_userProfileId: {
            jobId: run.jobId,
            userProfileId: run.userProfileId,
          },
        },
        select: { recommendation: true },
      });
      matchRecommendation = match?.recommendation ?? null;
    }

    return this.mapRunToDto(run, matchRecommendation);
  }

  /**
   * Retrieves chronological event history for an AgentRun
   */
  async getRunEvents(runId: string): Promise<AgentRunEventDto[]> {
    const run = await prisma.agentRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new AgentRunNotFoundError(runId);
    }

    const events = await prisma.agentRunEvent.findMany({
      where: { agentRunId: runId },
      orderBy: { createdAt: 'asc' },
    });

    return events.map((e) => this.mapEventToDto(e));
  }

  /**
   * Human approval: resumes workflow from WAITING_FOR_HUMAN and completes run
   */
  async approveRun(runId: string): Promise<AgentRunDto> {
    const run = await prisma.agentRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new AgentRunNotFoundError(runId);
    }

    // Enforce state machine: ONLY allowed when WAITING_FOR_HUMAN
    if (run.status !== 'WAITING_FOR_HUMAN') {
      throw new AgentActionNotAllowedError('APPROVE', run.status, 'WAITING_FOR_HUMAN');
    }

    // Record approval event
    await this.recordEvent(
      runId,
      'HUMAN_REVIEW',
      'APPROVED',
      'Human candidate approved workflow continuation.'
    );

    // Transition WAITING_FOR_HUMAN -> RUNNING
    await prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: 'RUNNING',
        currentStep: 'HUMAN_REVIEW',
      },
    });

    // Execute Continuation Graph
    const continuationState = await agentContinuationGraph.invoke({
      runId,
      userProfileId: run.userProfileId,
      jobId: run.jobId,
      applicationId: run.applicationId,
      currentStep: 'HUMAN_REVIEW',
      status: 'RUNNING',
      decision: 'APPROVED',
      matchScore: run.matchScore,
    });

    // Record completion event
    await this.recordEvent(
      runId,
      'COMPLETED',
      'COMPLETED',
      'Agent run completed successfully following human approval.'
    );

    const completedRun = await prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        currentStep: 'COMPLETED',
        decision: 'APPROVED',
        completedAt: new Date(continuationState.timestamps?.completedAt || new Date()),
      },
    });

    let matchRecommendation: string | null = null;
    if (run.jobId && run.userProfileId) {
      const match = await prisma.jobMatch.findUnique({
        where: {
          jobId_userProfileId: {
            jobId: run.jobId,
            userProfileId: run.userProfileId,
          },
        },
        select: { recommendation: true },
      });
      matchRecommendation = match?.recommendation ?? null;
    }

    return this.mapRunToDto(completedRun, matchRecommendation);
  }

  /**
   * Human rejection: safely terminates workflow from WAITING_FOR_HUMAN to CANCELLED
   */
  async rejectRun(runId: string, reason?: string): Promise<AgentRunDto> {
    const run = await prisma.agentRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new AgentRunNotFoundError(runId);
    }

    // Enforce state machine: ONLY allowed when WAITING_FOR_HUMAN
    if (run.status !== 'WAITING_FOR_HUMAN') {
      throw new AgentActionNotAllowedError('REJECT', run.status, 'WAITING_FOR_HUMAN');
    }

    const rejectionMessage = reason || 'Human reviewer rejected workflow continuation.';

    await this.recordEvent(
      runId,
      'HUMAN_REVIEW',
      'REJECTED',
      rejectionMessage
    );

    const cancelledRun = await prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: 'CANCELLED',
        currentStep: 'HUMAN_REVIEW',
        decision: 'REJECTED',
        errorMessage: rejectionMessage,
        completedAt: new Date(),
      },
    });

    let matchRecommendation: string | null = null;
    if (run.jobId && run.userProfileId) {
      const match = await prisma.jobMatch.findUnique({
        where: {
          jobId_userProfileId: {
            jobId: run.jobId,
            userProfileId: run.userProfileId,
          },
        },
        select: { recommendation: true },
      });
      matchRecommendation = match?.recommendation ?? null;
    }

    return this.mapRunToDto(cancelledRun, matchRecommendation);
  }
}

export const agentService = new AgentService();
