import type { Job } from './job.js';
import type { PaginationMetadata } from './job.js';

export type MatchRecommendation = 'APPLY' | 'CONSIDER' | 'LOW_PRIORITY' | 'DO_NOT_APPLY';

export interface JobMatchScoreBreakdown {
  skill: number;
  experience: number;
  role: number;
  preference: number;
  location: number;
}

export interface JobMatchAnalysis {
  semanticSkillScore: number;
  roleAlignmentScore: number;
  responsibilityAlignmentScore: number;
  strengths: string[];
  gaps: string[];
  explanation: string;
}

export interface JobMatch {
  id: string;
  jobId: string;
  userProfileId: string;
  overallScore: number;
  skillScore: number;
  experienceScore: number;
  roleScore: number;
  preferenceScore: number;
  locationScore: number;
  recommendation: MatchRecommendation;
  strengths: string[];
  gaps: string[];
  aiAnalysis: JobMatchAnalysis;
  createdAt: string;
  updatedAt: string;
  job?: Job;
}

export interface JobMatchResponse {
  id?: string;
  jobId: string;
  overallScore: number;
  recommendation: MatchRecommendation;
  scores: JobMatchScoreBreakdown;
  strengths: string[];
  gaps: string[];
  explanation: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobMatchListResponse {
  matches: (JobMatch & { job: Job })[];
  pagination: PaginationMetadata;
}

export interface JobMatchSearchParams {
  page?: number;
  pageSize?: number;
  minimumScore?: number;
  recommendation?: MatchRecommendation;
  sort?: 'overallScore_desc' | 'overallScore_asc' | 'createdAt_desc' | 'createdAt_asc';
}
