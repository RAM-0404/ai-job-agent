import type {
  AgentStatus,
  AgentStep,
  AgentDecision,
} from '@ai-job-agent/shared';
import type { UserProfile, Job, Application, JobMatch } from '@prisma/client';

export type { AgentStatus, AgentStep, AgentDecision };

export type CandidateContext = UserProfile & {
  skills?: Array<{ name: string; category?: string | null; proficiency?: string | null }>;
  experiences?: Array<{
    company: string;
    jobTitle: string;
    startDate: Date;
    endDate?: Date | null;
    isCurrent?: boolean;
    description?: string | null;
  }>;
  education?: Array<{
    institution: string;
    degree?: string | null;
    fieldOfStudy?: string | null;
  }>;
};

export type JobContext = Job;
export type ApplicationContext = Application;
export type MatchContext = JobMatch;

export interface AgentContextEntities {
  candidate?: CandidateContext | null;
  job?: JobContext | null;
  application?: ApplicationContext | null;
  match?: MatchContext | null;
}
