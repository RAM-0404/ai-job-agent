import { prisma } from '../db/prisma.js';
import { config } from '../config/env.js';
import type { UserProfileResponse, UpdateProfileRequest } from '@ai-job-agent/shared';

export async function getCurrentProfile(): Promise<UserProfileResponse | null> {
  const profile = await prisma.userProfile.findFirst({
    orderBy: { createdAt: 'asc' },
  });

  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    fullName: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    professionalSummary: profile.professionalSummary,
    currentTitle: profile.currentTitle,
    yearsOfExperience: profile.yearsOfExperience,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export async function updateOrCreateProfile(
  input: UpdateProfileRequest
): Promise<UserProfileResponse> {
  const existing = await prisma.userProfile.findFirst({
    orderBy: { createdAt: 'asc' },
  });

  let profile;
  if (existing) {
    profile = await prisma.userProfile.update({
      where: { id: existing.id },
      data: {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone !== undefined ? input.phone : existing.phone,
        professionalSummary:
          input.professionalSummary !== undefined
            ? input.professionalSummary
            : existing.professionalSummary,
        currentTitle:
          input.currentTitle !== undefined ? input.currentTitle : existing.currentTitle,
        yearsOfExperience:
          input.yearsOfExperience !== undefined
            ? input.yearsOfExperience
            : existing.yearsOfExperience,
      },
    });
  } else {
    profile = await prisma.userProfile.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone || null,
        professionalSummary: input.professionalSummary || null,
        currentTitle: input.currentTitle || null,
        yearsOfExperience: input.yearsOfExperience !== undefined ? input.yearsOfExperience : null,
      },
    });
  }

  return {
    id: profile.id,
    fullName: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    professionalSummary: profile.professionalSummary,
    currentTitle: profile.currentTitle,
    yearsOfExperience: profile.yearsOfExperience,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export async function ensureUserProfileId(): Promise<string> {
  const existing = await prisma.userProfile.findFirst({
    orderBy: { createdAt: 'asc' },
  });

  if (existing) {
    return existing.id;
  }

  const created = await prisma.userProfile.create({
    data: {
      fullName: 'Default User',
      email: config.defaultUserEmail,
    },
  });

  return created.id;
}
