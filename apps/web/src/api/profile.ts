import { apiClient, ApiError } from './client';
import type { UserProfileResponse, UpdateProfileRequest } from '@ai-job-agent/shared';

export async function getProfile(): Promise<UserProfileResponse | null> {
  try {
    return await apiClient<UserProfileResponse>('/profile');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function updateProfile(
  data: UpdateProfileRequest
): Promise<UserProfileResponse> {
  return apiClient<UserProfileResponse>('/profile', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
