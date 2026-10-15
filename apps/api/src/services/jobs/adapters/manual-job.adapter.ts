import type { JobSourceType, RawJobInput } from '@ai-job-agent/shared';
import type { JobSourceAdapter } from './job-source-adapter.js';

export class ManualJobAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManualJobAdapterError';
  }
}

export class ManualJobAdapter implements JobSourceAdapter {
  readonly sourceType: JobSourceType = 'MANUAL';

  /**
   * Accepts manual/imported job items and converts them to RawJobInput[]
   */
  async fetchJobs(input: unknown): Promise<RawJobInput[]> {
    if (!input) {
      throw new ManualJobAdapterError('Input payload cannot be empty.');
    }

    let items: unknown[] = [];

    if (Array.isArray(input)) {
      items = input;
    } else if (typeof input === 'object' && input !== null && 'jobs' in input && Array.isArray((input as any).jobs)) {
      items = (input as any).jobs;
    } else if (typeof input === 'object' && input !== null) {
      // Single job object
      items = [input];
    } else {
      throw new ManualJobAdapterError('Expected an array of jobs or a job payload object.');
    }

    const validatedJobs: RawJobInput[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (typeof item !== 'object' || item === null) {
        throw new ManualJobAdapterError(`Job at index ${i} is not a valid object.`);
      }

      const jobObj = item as Record<string, any>;

      if (!jobObj.title || typeof jobObj.title !== 'string' || !jobObj.title.trim()) {
        throw new ManualJobAdapterError(`Job at index ${i} is missing a required 'title' string.`);
      }

      if (!jobObj.companyName || typeof jobObj.companyName !== 'string' || !jobObj.companyName.trim()) {
        throw new ManualJobAdapterError(`Job at index ${i} is missing a required 'companyName' string.`);
      }

      if (!jobObj.description || typeof jobObj.description !== 'string' || !jobObj.description.trim()) {
        throw new ManualJobAdapterError(`Job at index ${i} is missing a required 'description' string.`);
      }

      validatedJobs.push({
        externalId: jobObj.externalId !== undefined ? String(jobObj.externalId).trim() || null : null,
        title: jobObj.title.trim(),
        companyName: jobObj.companyName.trim(),
        description: jobObj.description.trim(),
        location: jobObj.location ? String(jobObj.location).trim() : null,
        locations: Array.isArray(jobObj.locations) ? jobObj.locations.map(String) : undefined,
        workMode: jobObj.workMode,
        employmentType: jobObj.employmentType,
        experienceLevel: jobObj.experienceLevel,
        salary: jobObj.salary,
        salaryMin: jobObj.salaryMin,
        salaryMax: jobObj.salaryMax,
        salaryCurrency: jobObj.salaryCurrency,
        applicationUrl: jobObj.applicationUrl,
        publishedAt: jobObj.publishedAt,
        expiresAt: jobObj.expiresAt,
        rawPayload: jobObj.rawPayload ?? jobObj,
      });
    }

    return validatedJobs;
  }
}

export const manualJobAdapter = new ManualJobAdapter();
