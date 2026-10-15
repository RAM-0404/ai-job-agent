export interface UserProfileResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  professionalSummary: string | null;
  currentTitle: string | null;
  yearsOfExperience: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileRequest {
  fullName: string;
  email: string;
  phone?: string | null;
  professionalSummary?: string | null;
  currentTitle?: string | null;
  yearsOfExperience?: number | null;
}
