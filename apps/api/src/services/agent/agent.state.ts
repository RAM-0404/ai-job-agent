import { Annotation } from '@langchain/langgraph';
import type {
  AgentStatus,
  AgentStep,
  AgentDecision,
} from '@ai-job-agent/shared';
import type { AgentContextEntities } from './agent.types.js';

export const AgentStateAnnotation = Annotation.Root({
  runId: Annotation<string>(),
  userProfileId: Annotation<string>(),
  jobId: Annotation<string | null | undefined>({
    reducer: (prev, next) => next !== undefined ? next : prev,
    default: () => null,
  }),
  applicationId: Annotation<string | null | undefined>({
    reducer: (prev, next) => next !== undefined ? next : prev,
    default: () => null,
  }),
  currentStep: Annotation<AgentStep>({
    reducer: (prev, next) => next ?? prev,
    default: () => 'INITIALIZE',
  }),
  status: Annotation<AgentStatus>({
    reducer: (prev, next) => next ?? prev,
    default: () => 'IDLE',
  }),
  decision: Annotation<AgentDecision | null | undefined>({
    reducer: (prev, next) => next !== undefined ? next : prev,
    default: () => null,
  }),
  matchScore: Annotation<number | null | undefined>({
    reducer: (prev, next) => next !== undefined ? next : prev,
    default: () => null,
  }),
  matchRecommendation: Annotation<string | null | undefined>({
    reducer: (prev, next) => next !== undefined ? next : prev,
    default: () => null,
  }),
  requiresHumanApproval: Annotation<boolean>({
    reducer: (prev, next) => next ?? prev,
    default: () => false,
  }),
  applicationGenerated: Annotation<boolean>({
    reducer: (prev, next) => next ?? prev,
    default: () => false,
  }),
  applicationValidated: Annotation<boolean>({
    reducer: (prev, next) => next ?? prev,
    default: () => false,
  }),
  validationPassed: Annotation<boolean>({
    reducer: (prev, next) => next ?? prev,
    default: () => false,
  }),
  validationWarnings: Annotation<string[]>({
    reducer: (prev, next) => (next ? [...prev, ...next] : prev),
    default: () => [],
  }),
  errors: Annotation<string[]>({
    reducer: (prev, next) => (next ? [...prev, ...next] : prev),
    default: () => [],
  }),
  warnings: Annotation<string[]>({
    reducer: (prev, next) => (next ? [...prev, ...next] : prev),
    default: () => [],
  }),
  metadata: Annotation<Record<string, unknown>>({
    reducer: (prev, next) => ({ ...prev, ...(next || {}) }),
    default: () => ({}),
  }),
  context: Annotation<AgentContextEntities>({
    reducer: (prev, next) => ({ ...prev, ...(next || {}) }),
    default: () => ({}),
  }),
  timestamps: Annotation<{
    startedAt: string;
    completedAt?: string | null;
    updatedAt: string;
  }>({
    reducer: (prev, next) => ({ ...prev, ...(next || {}) }),
    default: () => ({
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;
export type AgentStateUpdate = typeof AgentStateAnnotation.Update;
