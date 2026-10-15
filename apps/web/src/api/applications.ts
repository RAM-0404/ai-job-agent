import { apiClient } from './client.js';
import type {
  ApplicationWorkspace,
  ApplicationListResponse,
  ApplicationSearchParams,
  UpdateApplicationInput,
  ApplicationExportResponse,
} from '@ai-job-agent/shared';

export interface GeneratedApplicationResponse {
  data: {
    coverLetter: string;
    resumeBullets: string[];
    applicationSummary: string;
  };
  validation: {
    isValid: boolean;
    warnings: string[];
    suspiciousClaims: string[];
  };
}

export interface GeneratedAnswersResponse {
  data: {
    answers: Array<{ question: string; answer: string }>;
  };
  validation: {
    isValid: boolean;
    warnings: string[];
    suspiciousClaims: string[];
  };
}

/**
 * Creates or retrieves the Application workspace for a given job ID.
 */
export async function createOrGetApplication(jobId: string): Promise<ApplicationWorkspace> {
  return apiClient<ApplicationWorkspace>(`/jobs/${jobId}/application`, {
    method: 'POST',
  });
}

/**
 * Queries paginated list of applications with filters.
 */
export async function getApplications(
  params: ApplicationSearchParams = {}
): Promise<ApplicationListResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.pageSize) searchParams.set('pageSize', params.pageSize.toString());
  if (params.status) searchParams.set('status', params.status);
  if (params.minimumScore !== undefined) searchParams.set('minimumScore', params.minimumScore.toString());
  if (params.company) searchParams.set('company', params.company);
  if (params.search) searchParams.set('search', params.search);

  const queryStr = searchParams.toString();
  const endpoint = `/applications${queryStr ? `?${queryStr}` : ''}`;
  return apiClient<ApplicationListResponse>(endpoint);
}

/**
 * Retrieves complete application workspace by application ID.
 */
export async function getApplicationWorkspace(id: string): Promise<ApplicationWorkspace> {
  return apiClient<ApplicationWorkspace>(`/applications/${id}`);
}

/**
 * Generates tailored cover letter, resume bullets, and application summary with AI.
 */
export async function generateApplication(id: string): Promise<GeneratedApplicationResponse> {
  return apiClient<GeneratedApplicationResponse>(`/applications/${id}/generate`, {
    method: 'POST',
  });
}

/**
 * Generates AI answers for arbitrary application form questions.
 */
export async function generateAnswers(
  id: string,
  questions: string[]
): Promise<GeneratedAnswersResponse> {
  return apiClient<GeneratedAnswersResponse>(`/applications/${id}/answers/generate`, {
    method: 'POST',
    body: JSON.stringify({ questions }),
  });
}

/**
 * Updates application documents or answers with human edits.
 */
export async function updateApplication(
  id: string,
  input: UpdateApplicationInput
): Promise<ApplicationWorkspace> {
  return apiClient<ApplicationWorkspace>(`/applications/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/**
 * Transitions application from DRAFT to IN_REVIEW.
 */
export async function reviewApplication(id: string): Promise<ApplicationWorkspace> {
  return apiClient<ApplicationWorkspace>(`/applications/${id}/review`, {
    method: 'POST',
    body: JSON.stringify({ action: 'START_REVIEW' }),
  });
}

/**
 * Human approval: transitions application from IN_REVIEW to APPROVED.
 */
export async function approveApplication(id: string): Promise<ApplicationWorkspace> {
  return apiClient<ApplicationWorkspace>(`/applications/${id}/approve`, {
    method: 'POST',
  });
}

/**
 * Human rejection: transitions application from IN_REVIEW to REJECTED.
 */
export async function rejectApplication(
  id: string,
  reason?: string
): Promise<ApplicationWorkspace> {
  return apiClient<ApplicationWorkspace>(`/applications/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({
      reason: reason || 'Rejected by candidate during review.',
    }),
  });
}

/**
 * Exports approved application materials locally into storage/exports/applications/{id}/.
 */
export async function exportApplication(id: string): Promise<ApplicationExportResponse> {
  return apiClient<ApplicationExportResponse>(`/applications/${id}/export`, {
    method: 'POST',
  });
}
