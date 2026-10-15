import type { Job, PaginationMetadata } from './job.js';
import type { UserProfileResponse } from './profile.js';
import type { JobMatch } from './job-match.js';

export type UserProfile = UserProfileResponse;

export type ApplicationStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPORTED';

export type ApplicationDocumentType = 'COVER_LETTER' | 'RESUME_BULLETS' | 'APPLICATION_SUMMARY';

export type AnswerSource = 'AI_GENERATED' | 'USER_EDITED';

export interface ApplicationAnswer {
  id: string;
  applicationId: string;
  question: string;
  answer: string;
  originalAnswer?: string | null;
  source: AnswerSource;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationDocument {
  id: string;
  applicationId: string;
  type: ApplicationDocumentType;
  content: string;
  originalContent?: string | null;
  source: AnswerSource;
  createdAt: string;
  updatedAt: string;
}

export interface Application {
  id: string;
  jobId: string;
  userProfileId: string;
  status: ApplicationStatus;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  job?: Job;
  userProfile?: UserProfile;
  answers?: ApplicationAnswer[];
  documents?: ApplicationDocument[];
  match?: JobMatch | null;
}

export interface ApplicationWorkspace {
  application: Application;
  job: Job;
  userProfile: UserProfile;
  match?: JobMatch | null;
  answers: ApplicationAnswer[];
  documents: Record<ApplicationDocumentType, ApplicationDocument | null>;
}

export interface ApplicationSearchParams {
  status?: ApplicationStatus;
  minimumScore?: number;
  company?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ApplicationListItem extends Application {
  job: Job;
  matchScore?: number | null;
}

export interface ApplicationListResponse {
  applications: ApplicationListItem[];
  pagination: PaginationMetadata;
}

export interface GenerateAnswersInput {
  questions: string[];
}

export interface UpdateApplicationInput {
  documents?: Array<{
    type: ApplicationDocumentType;
    content: string;
  }>;
  answers?: Array<{
    id?: string;
    question?: string;
    answer: string;
  }>;
}

export interface ReviewApplicationInput {
  action: 'START_REVIEW';
}

export interface RejectApplicationInput {
  reason: string;
}

export interface ApplicationExportFile {
  name: string;
  path: string;
  sizeBytes: number;
}

export interface ApplicationExportResponse {
  applicationId: string;
  exportDirectory: string;
  files: ApplicationExportFile[];
  exportedAt: string;
}
