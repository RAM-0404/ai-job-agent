import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prisma } from '../../db/prisma.js';
import type {
  MultiStepWorkflowState,
  MultiStepWorkflowStatus,
  WorkflowOperationRecord,
  WorkflowOperationStatus,
  WorkflowOperationType,
  WorkflowRecoveryStatus,
} from '@ai-job-agent/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_STORAGE_DIR = path.resolve(__dirname, '../../../storage/browser/workflows');

export class WorkflowPersistenceService {
  private readonly storageDir: string;
  private isInitialized = false;

  constructor(customStorageDir?: string) {
    this.storageDir = customStorageDir || DEFAULT_STORAGE_DIR;
  }

  private async ensureStorageDir(): Promise<void> {
    if (this.isInitialized) return;
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      await fs.mkdir(path.join(this.storageDir, 'operations'), { recursive: true });
      this.isInitialized = true;
    } catch {
      // Best effort
    }
  }

  /**
   * Sanitizes workflow state to ensure passwords, authentication secrets, or
   * non-serializable data are never stored in durable records.
   */
  public sanitizeWorkflowState(state: MultiStepWorkflowState): MultiStepWorkflowState {
    const cloned: MultiStepWorkflowState = JSON.parse(JSON.stringify(state));

    // Sanitize discovered fields & proposals
    if (Array.isArray(cloned.discoveredFields)) {
      for (const field of cloned.discoveredFields) {
        if (field.type === 'PASSWORD' || field.type === 'UNKNOWN') {
          field.hasValue = false;
        }
      }
    }

    if (Array.isArray(cloned.currentProposals)) {
      for (const prop of cloned.currentProposals) {
        if (prop.fieldType === 'PASSWORD' || prop.fieldType === 'UNKNOWN') {
          prop.proposedValue = '';
          prop.approved = false;
        }
      }
    }

    if (Array.isArray(cloned.stepHistory)) {
      for (const step of cloned.stepHistory) {
        if (Array.isArray(step.discoveredFields)) {
          for (const field of step.discoveredFields) {
            if (field.type === 'PASSWORD' || field.type === 'UNKNOWN') {
              field.hasValue = false;
            }
          }
        }
        if (Array.isArray(step.proposals)) {
          for (const prop of step.proposals) {
            if (prop.fieldType === 'PASSWORD' || prop.fieldType === 'UNKNOWN') {
              prop.proposedValue = '';
              prop.approved = false;
            }
          }
        }
      }
    }

    return cloned;
  }

  /**
   * Durably persists a workflow state snapshot.
   * Increments version number for optimistic concurrency.
   */
  async saveWorkflowState(
    state: MultiStepWorkflowState,
    userProfileId?: string
  ): Promise<MultiStepWorkflowState> {
    await this.ensureStorageDir();

    const sanitized = this.sanitizeWorkflowState(state);
    sanitized.version = (sanitized.version || 0) + 1;
    sanitized.lastUpdated = new Date().toISOString();

    // 1. Attempt persistence to PostgreSQL via Prisma
    try {
      const client = prisma as any;
      if (client.browserWorkflowRun) {
        await client.browserWorkflowRun.upsert({
          where: { sessionId: sanitized.sessionId },
          create: {
            sessionId: sanitized.sessionId,
            userProfileId: userProfileId || null,
            status: sanitized.status,
            version: sanitized.version,
            currentStepIndex: sanitized.currentStepIndex,
            currentStepId: sanitized.currentStepId,
            currentStepHeading: sanitized.currentStepHeading,
            currentUrl: sanitized.currentUrl,
            workflowState: sanitized,
            recoveryStatus: sanitized.recoveryStatus || null,
            lastReconciledAt: sanitized.lastReconciledAt ? new Date(sanitized.lastReconciledAt) : null,
          },
          update: {
            status: sanitized.status,
            version: sanitized.version,
            currentStepIndex: sanitized.currentStepIndex,
            currentStepId: sanitized.currentStepId,
            currentStepHeading: sanitized.currentStepHeading,
            currentUrl: sanitized.currentUrl,
            workflowState: sanitized,
            recoveryStatus: sanitized.recoveryStatus || null,
            lastReconciledAt: sanitized.lastReconciledAt ? new Date(sanitized.lastReconciledAt) : null,
          },
        });
      }
    } catch {
      // Database offline/unreachable fallback
    }

    // 2. Durably write atomic file-based checkpoint to survive API restarts
    const filePath = path.join(this.storageDir, `${sanitized.sessionId}.json`);
    const tempPath = `${filePath}.${Date.now()}-${randomUUID()}.tmp`;
    const data = JSON.stringify(sanitized, null, 2);

    await fs.writeFile(tempPath, data, 'utf-8');
    try {
      await fs.rename(tempPath, filePath);
    } catch {
      try {
        await fs.copyFile(tempPath, filePath);
        await fs.unlink(tempPath).catch(() => {});
      } catch {
        // Best effort
      }
    }

    return sanitized;
  }

  /**
   * Retrieves the last persisted workflow state snapshot for a session.
   */
  async getPersistedWorkflowState(sessionId: string): Promise<MultiStepWorkflowState | null> {
    // 1. Try PostgreSQL via Prisma
    try {
      const client = prisma as any;
      if (client.browserWorkflowRun) {
        const record = await client.browserWorkflowRun.findUnique({
          where: { sessionId },
        });
        if (record && record.workflowState) {
          return record.workflowState as MultiStepWorkflowState;
        }
      }
    } catch {
      // Fall through to durable file checkpoint
    }

    // 2. Fall back to durable disk snapshot
    try {
      await this.ensureStorageDir();
      const filePath = path.join(this.storageDir, `${sessionId}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as MultiStepWorkflowState;
    } catch {
      return null;
    }
  }

  /**
   * Deletes persisted workflow state and its associated operations.
   */
  async deleteWorkflowState(sessionId: string): Promise<void> {
    try {
      const client = prisma as any;
      if (client.browserWorkflowRun) {
        await client.browserWorkflowRun.delete({
          where: { sessionId },
        }).catch(() => {});
      }
    } catch {
      // Best effort
    }

    try {
      await this.ensureStorageDir();
      const filePath = path.join(this.storageDir, `${sessionId}.json`);
      await fs.unlink(filePath).catch(() => {});
    } catch {
      // Best effort
    }
  }

  /**
   * Persists an operation record for idempotency tracking.
   */
  async saveOperation(record: WorkflowOperationRecord): Promise<WorkflowOperationRecord> {
    await this.ensureStorageDir();

    // 1. Try PostgreSQL via Prisma
    try {
      const client = prisma as any;
      if (client.browserWorkflowOperation) {
        await client.browserWorkflowOperation.upsert({
          where: {
            sessionId_idempotencyKey: {
              sessionId: record.sessionId,
              idempotencyKey: record.idempotencyKey,
            },
          },
          create: {
            sessionId: record.sessionId,
            idempotencyKey: record.idempotencyKey,
            operationType: record.operationType,
            requestPayloadHash: record.requestPayloadHash,
            status: record.status,
            responsePayload: record.responsePayload || null,
            errorMessage: record.errorMessage || null,
            completedAt: record.completedAt ? new Date(record.completedAt) : null,
          },
          update: {
            status: record.status,
            responsePayload: record.responsePayload || null,
            errorMessage: record.errorMessage || null,
            completedAt: record.completedAt ? new Date(record.completedAt) : null,
          },
        });
      }
    } catch {
      // Fallback to disk
    }

    // 2. Write file-based operation record
    const opFileName = `${record.sessionId}_${record.idempotencyKey}.json`;
    const opFilePath = path.join(this.storageDir, 'operations', opFileName);
    const tempPath = `${opFilePath}.${Date.now()}-${randomUUID()}.tmp`;

    await fs.writeFile(tempPath, JSON.stringify(record, null, 2), 'utf-8');
    try {
      await fs.rename(tempPath, opFilePath);
    } catch {
      try {
        await fs.copyFile(tempPath, opFilePath);
        await fs.unlink(tempPath).catch(() => {});
      } catch {
        // Best effort
      }
    }

    return record;
  }

  /**
   * Retrieves a persisted operation record by session ID and idempotency key.
   */
  async getOperation(
    sessionId: string,
    idempotencyKey: string
  ): Promise<WorkflowOperationRecord | null> {
    // 1. Try PostgreSQL via Prisma
    try {
      const client = prisma as any;
      if (client.browserWorkflowOperation) {
        const record = await client.browserWorkflowOperation.findUnique({
          where: {
            sessionId_idempotencyKey: {
              sessionId,
              idempotencyKey,
            },
          },
        });
        if (record) {
          return {
            id: record.id,
            sessionId: record.sessionId,
            idempotencyKey: record.idempotencyKey,
            operationType: record.operationType as WorkflowOperationType,
            requestPayloadHash: record.requestPayloadHash,
            status: record.status as WorkflowOperationStatus,
            responsePayload: record.responsePayload,
            errorMessage: record.errorMessage || undefined,
            createdAt: record.createdAt.toISOString(),
            updatedAt: record.updatedAt.toISOString(),
            completedAt: record.completedAt ? record.completedAt.toISOString() : undefined,
          };
        }
      }
    } catch {
      // Fall through to disk
    }

    // 2. Try file-based record
    try {
      await this.ensureStorageDir();
      const opFileName = `${sessionId}_${idempotencyKey}.json`;
      const opFilePath = path.join(this.storageDir, 'operations', opFileName);
      const content = await fs.readFile(opFilePath, 'utf-8');
      return JSON.parse(content) as WorkflowOperationRecord;
    } catch {
      return null;
    }
  }

  /**
   * Updates an existing operation's status and response/error payload.
   */
  async updateOperationStatus(
    sessionId: string,
    idempotencyKey: string,
    status: WorkflowOperationStatus,
    responsePayload?: any,
    errorMessage?: string
  ): Promise<WorkflowOperationRecord | null> {
    const existing = await this.getOperation(sessionId, idempotencyKey);
    if (!existing) return null;

    existing.status = status;
    existing.responsePayload = responsePayload !== undefined ? responsePayload : existing.responsePayload;
    existing.errorMessage = errorMessage !== undefined ? errorMessage : existing.errorMessage;
    existing.updatedAt = new Date().toISOString();
    if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'REQUIRES_REVIEW') {
      existing.completedAt = new Date().toISOString();
    }

    return this.saveOperation(existing);
  }

  /**
   * Lists all operations for a given session.
   */
  async listOperationsForSession(sessionId: string): Promise<WorkflowOperationRecord[]> {
    const results: WorkflowOperationRecord[] = [];
    try {
      await this.ensureStorageDir();
      const opsDir = path.join(this.storageDir, 'operations');
      const files = await fs.readdir(opsDir).catch(() => []);
      for (const file of files) {
        if (file.startsWith(`${sessionId}_`) && file.endsWith('.json')) {
          try {
            const content = await fs.readFile(path.join(opsDir, file), 'utf-8');
            results.push(JSON.parse(content));
          } catch {
            // ignore corrupted
          }
        }
      }
    } catch {
      // ignore
    }
    return results.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }
}

export const workflowPersistenceService = new WorkflowPersistenceService();
