import type { Prisma, Job } from '@prisma/client';
import type { NormalizedJobData } from './job-normalizer.service.js';

export class JobDeduplicationService {
  /**
   * Generates a deterministic fallback fingerprint string for jobs without externalId
   */
  generateFingerprint(normalized: NormalizedJobData): string {
    const comp = normalized.companyName.toLowerCase().trim();
    const title = normalized.title.toLowerCase().trim();

    if (normalized.applicationUrl) {
      return `${comp}|${title}|${normalized.applicationUrl.toLowerCase().trim()}`;
    }

    if (normalized.location) {
      return `${comp}|${title}|${normalized.location.toLowerCase().trim()}`;
    }

    return `${comp}|${title}`;
  }

  /**
   * Finds an existing job record matching the primary externalId strategy or fallback fingerprint
   */
  async findExistingJob(
    tx: Prisma.TransactionClient,
    jobSourceId: string,
    normalized: NormalizedJobData
  ): Promise<Job | null> {
    // 1. Primary Strategy: same jobSource + same externalId
    if (normalized.externalId && normalized.externalId.trim().length > 0) {
      const match = await tx.job.findFirst({
        where: {
          jobSourceId,
          externalId: normalized.externalId.trim(),
        },
      });

      if (match) return match;
    }

    // 2. Fallback Strategy: company + title + applicationUrl
    if (normalized.applicationUrl) {
      const match = await tx.job.findFirst({
        where: {
          jobSourceId,
          companyName: { equals: normalized.companyName.trim(), mode: 'insensitive' },
          title: { equals: normalized.title.trim(), mode: 'insensitive' },
          applicationUrl: normalized.applicationUrl.trim(),
        },
      });

      if (match) return match;
    }

    // 3. Fallback Strategy: company + title + location (when applicationUrl is absent)
    if (normalized.location) {
      const match = await tx.job.findFirst({
        where: {
          jobSourceId,
          companyName: { equals: normalized.companyName.trim(), mode: 'insensitive' },
          title: { equals: normalized.title.trim(), mode: 'insensitive' },
          location: { equals: normalized.location.trim(), mode: 'insensitive' },
        },
      });

      if (match) return match;
    }

    return null;
  }

  /**
   * Compares an existing job record with normalized incoming data to determine if an update is needed
   */
  hasMeaningfulChanges(existing: Job, incoming: NormalizedJobData): boolean {
    if (existing.title !== incoming.title) return true;
    if (existing.companyName !== incoming.companyName) return true;
    if (existing.description !== incoming.description) return true;
    if (existing.location !== incoming.location) return true;
    if (existing.workMode !== incoming.workMode) return true;
    if (existing.employmentType !== incoming.employmentType) return true;
    if (existing.experienceLevel !== incoming.experienceLevel) return true;
    if (existing.salaryMin !== incoming.salaryMin) return true;
    if (existing.salaryMax !== incoming.salaryMax) return true;
    if (existing.salaryCurrency !== incoming.salaryCurrency) return true;
    if (existing.applicationUrl !== incoming.applicationUrl) return true;

    // Compare Dates
    const existingPublished = existing.publishedAt ? existing.publishedAt.getTime() : null;
    const incomingPublished = incoming.publishedAt ? incoming.publishedAt.getTime() : null;
    if (existingPublished !== incomingPublished) return true;

    const existingExpires = existing.expiresAt ? existing.expiresAt.getTime() : null;
    const incomingExpires = incoming.expiresAt ? incoming.expiresAt.getTime() : null;
    if (existingExpires !== incomingExpires) return true;

    // Compare locations array
    if (existing.locations.length !== incoming.locations.length) return true;
    for (let i = 0; i < existing.locations.length; i++) {
      if (existing.locations[i] !== incoming.locations[i]) return true;
    }

    return false;
  }

  hasChanged(existing: Job, incoming: NormalizedJobData): boolean {
    return this.hasMeaningfulChanges(existing, incoming);
  }
}

export const jobDeduplicationService = new JobDeduplicationService();
