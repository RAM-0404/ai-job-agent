import { prisma } from '../../db/prisma.js';
import type { Prisma, Job as PrismaJob } from '@prisma/client';
import { manualJobAdapter } from './adapters/manual-job.adapter.js';
import { jobNormalizerService } from './job-normalizer.service.js';
import { jobDeduplicationService } from './job-deduplication.service.js';
import type {
  Job,
  JobListResponse,
  JobDetailResponse,
  JobSearchParams,
  JobIngestionInput,
  JobIngestionResult,
  DiscoveryRunListResponse,
  DiscoveryRun,
} from '@ai-job-agent/shared';

export class JobNotFoundError extends Error {
  constructor(id: string) {
    super(`Job with ID "${id}" not found.`);
    this.name = 'JobNotFoundError';
  }
}

export class JobService {
  /**
   * Imports one or more jobs from a source, running normalization and deduplication
   */
  async importJobs(input: JobIngestionInput): Promise<JobIngestionResult> {
    const sourceName = input.source?.name?.trim() || 'Manual Import';
    const sourceType = input.source?.type || 'MANUAL';
    const baseUrl = input.source?.baseUrl ? input.source.baseUrl.trim() : null;

    // 1. Find or create JobSource
    let source = await prisma.jobSource.findUnique({
      where: { name: sourceName },
    });

    if (!source) {
      source = await prisma.jobSource.create({
        data: {
          name: sourceName,
          type: sourceType,
          baseUrl,
          isActive: true,
        },
      });
    }

    // 2. Create DiscoveryRun record with RUNNING status
    const run = await prisma.discoveryRun.create({
      data: {
        jobSourceId: source.id,
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    let jobsFetched = 0;
    let jobsCreated = 0;
    let jobsUpdated = 0;
    let jobsSkipped = 0;
    const errors: string[] = [];

    try {
      // 3. Adapter parses and extracts RawJobInput items
      const rawJobs = await manualJobAdapter.fetchJobs(input.jobs);
      jobsFetched = rawJobs.length;

      // 4. Normalize and deduplicate jobs inside database transaction
      await prisma.$transaction(async (tx) => {
        for (const rawJob of rawJobs) {
          const normalized = jobNormalizerService.normalizeJob(rawJob);

          // Check if job exists in this source
          const existing = await jobDeduplicationService.findExistingJob(tx, source.id, normalized);

          if (existing) {
            if (jobDeduplicationService.hasMeaningfulChanges(existing, normalized)) {
              await tx.job.update({
                where: { id: existing.id },
                data: {
                  title: normalized.title,
                  companyName: normalized.companyName,
                  description: normalized.description,
                  location: normalized.location,
                  locations: normalized.locations,
                  workMode: normalized.workMode,
                  employmentType: normalized.employmentType,
                  experienceLevel: normalized.experienceLevel,
                  salaryMin: normalized.salaryMin,
                  salaryMax: normalized.salaryMax,
                  salaryCurrency: normalized.salaryCurrency,
                  applicationUrl: normalized.applicationUrl,
                  publishedAt: normalized.publishedAt,
                  expiresAt: normalized.expiresAt,
                  rawPayload: normalized.rawPayload as Prisma.InputJsonValue,
                },
              });
              jobsUpdated++;
            } else {
              jobsSkipped++;
            }
          } else {
            await tx.job.create({
              data: {
                jobSourceId: source.id,
                externalId: normalized.externalId,
                title: normalized.title,
                companyName: normalized.companyName,
                description: normalized.description,
                location: normalized.location,
                locations: normalized.locations,
                workMode: normalized.workMode,
                employmentType: normalized.employmentType,
                experienceLevel: normalized.experienceLevel,
                salaryMin: normalized.salaryMin,
                salaryMax: normalized.salaryMax,
                salaryCurrency: normalized.salaryCurrency,
                applicationUrl: normalized.applicationUrl,
                publishedAt: normalized.publishedAt,
                expiresAt: normalized.expiresAt,
                rawPayload: normalized.rawPayload as Prisma.InputJsonValue,
              },
            });
            jobsCreated++;
          }
        }
      });

      // 5. Update DiscoveryRun to COMPLETED
      await prisma.discoveryRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          jobsFetched,
          jobsCreated,
          jobsUpdated,
          jobsSkipped,
        },
      });

      return {
        runId: run.id,
        sourceId: source.id,
        sourceName: source.name,
        status: 'COMPLETED',
        jobsFetched,
        jobsCreated,
        jobsUpdated,
        jobsSkipped,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown ingestion error';
      errors.push(errorMsg);

      await prisma.discoveryRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          jobsFetched,
          jobsCreated,
          jobsUpdated,
          jobsSkipped,
          errorMessage: errorMsg,
        },
      });

      return {
        runId: run.id,
        sourceId: source.id,
        sourceName: source.name,
        status: 'FAILED',
        jobsFetched,
        jobsCreated,
        jobsUpdated,
        jobsSkipped,
        errors,
      };
    }
  }

  /**
   * Queries paginated and filtered jobs
   */
  async getJobs(params: JobSearchParams): Promise<JobListResponse> {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));
    const skip = (page - 1) * pageSize;

    const where: Prisma.JobWhereInput = {};

    if (params.search && params.search.trim()) {
      const q = params.search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { companyName: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (params.company && params.company.trim()) {
      where.companyName = { contains: params.company.trim(), mode: 'insensitive' };
    }

    if (params.location && params.location.trim()) {
      const loc = params.location.trim();
      where.OR = [
        ...(where.OR || []),
        { location: { contains: loc, mode: 'insensitive' } },
        { locations: { has: loc } },
      ];
    }

    if (params.workMode && params.workMode !== 'UNKNOWN') {
      where.workMode = params.workMode;
    }

    if (params.employmentType && params.employmentType !== 'UNKNOWN') {
      where.employmentType = params.employmentType;
    }

    if (params.experienceLevel && params.experienceLevel !== 'UNKNOWN') {
      where.experienceLevel = params.experienceLevel;
    }

    if (params.publishedAfter) {
      const after = new Date(params.publishedAfter);
      if (!Number.isNaN(after.getTime())) {
        where.publishedAt = { ...(where.publishedAt as Prisma.DateTimeNullableFilter), gte: after };
      }
    }

    if (params.publishedBefore) {
      const before = new Date(params.publishedBefore);
      if (!Number.isNaN(before.getTime())) {
        where.publishedAt = { ...(where.publishedAt as Prisma.DateTimeNullableFilter), lte: before };
      }
    }

    const [total, records] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          jobSource: {
            select: { id: true, name: true, type: true },
          },
        },
      }),
    ]);

    const jobs: Job[] = records.map((r) => this.mapPrismaJob(r));

    return {
      jobs,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize) || 1,
      },
    };
  }

  /**
   * Retrieves single job details by ID
   */
  async getJobById(id: string): Promise<JobDetailResponse> {
    const record = await prisma.job.findUnique({
      where: { id },
      include: {
        jobSource: {
          select: { id: true, name: true, type: true, baseUrl: true },
        },
      },
    });

    if (!record) {
      throw new JobNotFoundError(id);
    }

    return {
      ...this.mapPrismaJob(record),
      jobSource: record.jobSource,
      rawPayload: record.rawPayload,
    };
  }

  /**
   * Retrieves recent discovery ingestion runs
   */
  async getDiscoveryRuns(limit = 20): Promise<DiscoveryRunListResponse> {
    const records = await prisma.discoveryRun.findMany({
      take: Math.min(100, Math.max(1, limit)),
      orderBy: { startedAt: 'desc' },
      include: {
        jobSource: {
          select: { name: true },
        },
      },
    });

    const runs: DiscoveryRun[] = records.map((r) => ({
      id: r.id,
      jobSourceId: r.jobSourceId,
      jobSourceName: r.jobSource.name,
      jobSource: {
        id: r.jobSourceId,
        name: r.jobSource.name,
      },
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      jobsFetched: r.jobsFetched,
      jobsCreated: r.jobsCreated,
      jobsUpdated: r.jobsUpdated,
      jobsSkipped: r.jobsSkipped,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt.toISOString(),
    }));

    return { runs };
  }

  private mapPrismaJob(
    record: PrismaJob & {
      jobSource?: { id: string; name: string; type: any };
    }
  ): Job {
    return {
      id: record.id,
      jobSourceId: record.jobSourceId,
      jobSource: record.jobSource,
      externalId: record.externalId,
      title: record.title,
      companyName: record.companyName,
      description: record.description,
      location: record.location,
      locations: record.locations,
      workMode: record.workMode,
      employmentType: record.employmentType,
      experienceLevel: record.experienceLevel,
      salaryMin: record.salaryMin,
      salaryMax: record.salaryMax,
      salaryCurrency: record.salaryCurrency,
      applicationUrl: record.applicationUrl,
      publishedAt: record.publishedAt ? record.publishedAt.toISOString() : null,
      expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

export const jobService = new JobService();
