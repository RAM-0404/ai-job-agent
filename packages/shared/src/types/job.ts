export type JobSourceType = 'MANUAL' | 'API' | 'FEED' | 'CAREER_PAGE';

export type WorkMode = 'REMOTE' | 'HYBRID' | 'ONSITE' | 'UNKNOWN';

export type EmploymentType =
  | 'FULL_TIME'
  | 'PART_TIME'
  | 'CONTRACT'
  | 'INTERNSHIP'
  | 'TEMPORARY'
  | 'UNKNOWN';

export type ExperienceLevel =
  | 'ENTRY'
  | 'JUNIOR'
  | 'MID'
  | 'SENIOR'
  | 'LEAD'
  | 'MANAGER'
  | 'DIRECTOR'
  | 'UNKNOWN';

export type DiscoveryRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface JobSource {
  id: string;
  name: string;
  type: JobSourceType;
  baseUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  jobSourceId: string;
  jobSource?: {
    id: string;
    name: string;
    type: JobSourceType;
  };
  externalId: string | null;
  title: string;
  companyName: string;
  description: string;
  location: string | null;
  locations: string[];
  workMode: WorkMode;
  employmentType: EmploymentType;
  experienceLevel: ExperienceLevel;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  applicationUrl: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginationMetadata {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface JobListResponse {
  jobs: Job[];
  pagination: PaginationMetadata;
}

export interface JobDetailResponse extends Job {
  jobSource: {
    id: string;
    name: string;
    type: JobSourceType;
    baseUrl: string | null;
  };
  rawPayload?: unknown;
}

export interface DiscoveryRun {
  id: string;
  jobSourceId: string;
  jobSourceName?: string;
  status: DiscoveryRunStatus;
  startedAt: string;
  completedAt: string | null;
  jobsFetched: number;
  jobsCreated: number;
  jobsUpdated: number;
  jobsSkipped: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface DiscoveryRunListResponse {
  runs: DiscoveryRun[];
}

export interface JobSearchParams {
  search?: string;
  company?: string;
  location?: string;
  workMode?: WorkMode;
  employmentType?: EmploymentType;
  experienceLevel?: ExperienceLevel;
  publishedAfter?: string;
  publishedBefore?: string;
  page?: number;
  pageSize?: number;
}

export interface RawJobInput {
  externalId?: string | null;
  title: string;
  companyName: string;
  description: string;
  location?: string | null;
  locations?: string[];
  workMode?: string | WorkMode | null;
  employmentType?: string | EmploymentType | null;
  experienceLevel?: string | ExperienceLevel | null;
  salary?: string | number | { min?: number | null; max?: number | null; currency?: string | null } | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  applicationUrl?: string | null;
  publishedAt?: string | Date | null;
  expiresAt?: string | Date | null;
  rawPayload?: unknown;
}

export interface JobSourceInput {
  name: string;
  type?: JobSourceType;
  baseUrl?: string | null;
}

export interface JobIngestionInput {
  source: JobSourceInput;
  jobs: RawJobInput[];
}

export interface JobIngestionResult {
  runId: string;
  sourceId: string;
  sourceName: string;
  status: DiscoveryRunStatus;
  jobsFetched: number;
  jobsCreated: number;
  jobsUpdated: number;
  jobsSkipped: number;
  errors?: string[];
}
