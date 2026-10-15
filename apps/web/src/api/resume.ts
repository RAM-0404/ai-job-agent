import { apiClient } from './client';
import type {
  ResumeResponse,
  ResumeListResponse,
  ResumeTextResponse,
  ResumeAnalysisResponse,
} from '@ai-job-agent/shared';

export async function uploadResume(file: File): Promise<ResumeResponse> {
  const formData = new FormData();
  formData.append('resume', file);

  return apiClient<ResumeResponse>('/profile/resumes', {
    method: 'POST',
    body: formData,
  });
}

export async function getResumes(): Promise<ResumeListResponse> {
  return apiClient<ResumeListResponse>('/profile/resumes');
}

export async function getResumeText(id: string): Promise<ResumeTextResponse> {
  return apiClient<ResumeTextResponse>(`/profile/resumes/${id}/text`);
}

export async function analyzeResume(id: string): Promise<ResumeAnalysisResponse> {
  return apiClient<ResumeAnalysisResponse>(`/profile/resumes/${id}/analyze`, {
    method: 'POST',
  });
}
