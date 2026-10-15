import { apiClient } from './client';
import type {
  JobListResponse,
  JobDetailResponse,
  JobSearchParams,
  JobIngestionInput,
  JobIngestionResult,
  DiscoveryRunListResponse,
} from '@ai-job-agent/shared';

export async function getJobs(params: JobSearchParams = {}): Promise<JobListResponse> {
  const query = new URLSearchParams();

  if (params.search) query.set('search', params.search);
  if (params.company) query.set('company', params.company);
  if (params.location) query.set('location', params.location);
  if (params.workMode && params.workMode !== 'UNKNOWN') query.set('workMode', params.workMode);
  if (params.employmentType && params.employmentType !== 'UNKNOWN')
    query.set('employmentType', params.employmentType);
  if (params.experienceLevel && params.experienceLevel !== 'UNKNOWN')
    query.set('experienceLevel', params.experienceLevel);
  if (params.publishedAfter) query.set('publishedAfter', params.publishedAfter);
  if (params.publishedBefore) query.set('publishedBefore', params.publishedBefore);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));

  const qs = query.toString();
  return apiClient<JobListResponse>(`/jobs${qs ? `?${qs}` : ''}`);
}

export async function getJobById(id: string): Promise<JobDetailResponse> {
  return apiClient<JobDetailResponse>(`/jobs/${id}`);
}

export async function importJobs(payload: JobIngestionInput): Promise<JobIngestionResult> {
  return apiClient<JobIngestionResult>('/jobs/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getDiscoveryRuns(): Promise<DiscoveryRunListResponse> {
  return apiClient<DiscoveryRunListResponse>('/jobs/discovery-runs');
}

export async function matchJob(jobId: string): Promise<import('@ai-job-agent/shared').JobMatchResponse> {
  return apiClient<import('@ai-job-agent/shared').JobMatchResponse>(`/jobs/${jobId}/match`, {
    method: 'POST',
  });
}

export async function getJobMatch(jobId: string): Promise<import('@ai-job-agent/shared').JobMatchResponse> {
  return apiClient<import('@ai-job-agent/shared').JobMatchResponse>(`/jobs/${jobId}/match`);
}

export async function getMatches(
  params: import('@ai-job-agent/shared').JobMatchSearchParams = {}
): Promise<import('@ai-job-agent/shared').JobMatchListResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.minimumScore !== undefined) query.set('minimumScore', String(params.minimumScore));
  if (params.recommendation) query.set('recommendation', params.recommendation);
  if (params.sort) query.set('sort', params.sort);

  const qs = query.toString();
  return apiClient<import('@ai-job-agent/shared').JobMatchListResponse>(`/matches${qs ? `?${qs}` : ''}`);
}
