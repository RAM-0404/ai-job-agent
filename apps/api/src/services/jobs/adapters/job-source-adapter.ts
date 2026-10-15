import type { JobSourceType, RawJobInput } from '@ai-job-agent/shared';

export interface JobSourceAdapter {
  readonly sourceType: JobSourceType;

  /**
   * Fetches or transforms source-specific payloads into RawJobInput format
   */
  fetchJobs(input: unknown): Promise<RawJobInput[]>;
}
