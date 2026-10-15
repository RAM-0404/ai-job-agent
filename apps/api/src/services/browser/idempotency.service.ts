import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import {
  workflowPersistenceService,
  WorkflowPersistenceService,
} from './workflow-persistence.service.js';
import {
  IdempotencyConflictError,
  OperationInProgressError,
} from './browser.errors.js';
import type {
  WorkflowOperationRecord,
  WorkflowOperationStatus,
  WorkflowOperationType,
} from '@ai-job-agent/shared';

export interface IdempotencyCheckResult<T> {
  cachedResult?: T;
  lockAcquired: boolean;
  operationId?: string;
}

export class IdempotencyService {
  /** In-flight concurrency locks keyed by sessionId */
  private readonly sessionLocks = new Map<string, { key: string; startedAt: number }>();
  private readonly lockTimeoutMs = 60_000; // 60s max lock lease

  constructor(
    private readonly persistence: WorkflowPersistenceService = workflowPersistenceService
  ) {}

  /**
   * Generates a stable SHA-256 hash of a normalized JSON payload.
   */
  hashPayload(payload: unknown): string {
    if (payload === undefined || payload === null) {
      return crypto.createHash('sha256').update('').digest('hex');
    }

    const canonicalJson = (obj: any): any => {
      if (obj === null || typeof obj !== 'object') {
        return obj;
      }
      if (Array.isArray(obj)) {
        return obj.map(canonicalJson);
      }
      const sortedKeys = Object.keys(obj).sort();
      const result: Record<string, any> = {};
      for (const k of sortedKeys) {
        result[k] = canonicalJson(obj[k]);
      }
      return result;
    };

    const normalized = JSON.stringify(canonicalJson(payload));
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Acquires execution rights and evaluates idempotency for an incoming request.
   * If the operation previously completed with identical parameters, returns the cached result.
   * If a mismatched payload or concurrent execution is detected, rejects with conflict.
   */
  async acquireOrCheckOperation<T>(
    sessionId: string,
    idempotencyKey: string | undefined,
    operationType: WorkflowOperationType,
    payload: unknown
  ): Promise<IdempotencyCheckResult<T>> {
    // 1. Check in-flight session lock
    const currentLock = this.sessionLocks.get(sessionId);
    if (currentLock) {
      const elapsed = Date.now() - currentLock.startedAt;
      if (elapsed < this.lockTimeoutMs) {
        if (idempotencyKey && currentLock.key === idempotencyKey) {
          throw new OperationInProgressError(
            `Operation with idempotency key "${idempotencyKey}" is currently running.`
          );
        }
        throw new OperationInProgressError(
          `Another mutating operation (${currentLock.key}) is currently running for session "${sessionId}".`
        );
      } else {
        // Lock expired
        this.sessionLocks.delete(sessionId);
      }
    }

    // Synchronously reserve session lock before any async boundaries
    const effectiveKey = idempotencyKey || `auto-${randomUUID()}`;
    this.sessionLocks.set(sessionId, { key: effectiveKey, startedAt: Date.now() });

    // If no idempotency key provided, proceed with auto-acquired lock
    if (!idempotencyKey) {
      return { lockAcquired: true, operationId: effectiveKey };
    }

    const payloadHash = this.hashPayload(payload);

    try {
      // 2. Check durable persistence for prior execution
      const existing = await this.persistence.getOperation(sessionId, idempotencyKey);
      if (existing) {
        // Reused key with different payload is strictly rejected
        if (existing.requestPayloadHash !== payloadHash) {
          this.sessionLocks.delete(sessionId);
          throw new IdempotencyConflictError(
            `Idempotency key "${idempotencyKey}" was already used with a different request payload.`
          );
        }

        // Completed successfully - return cached recorded result
        if (existing.status === 'SUCCEEDED' && existing.responsePayload) {
          this.sessionLocks.delete(sessionId);
          return {
            cachedResult: existing.responsePayload as T,
            lockAcquired: false,
            operationId: existing.id,
          };
        }

        // Still running or crashed in uncertain state
        if (existing.status === 'RUNNING') {
          throw new OperationInProgressError(
            `Operation with idempotency key "${idempotencyKey}" is currently running.`
          );
        }

        if (existing.status === 'REQUIRES_REVIEW' || existing.status === 'UNKNOWN') {
          this.sessionLocks.delete(sessionId);
          throw new IdempotencyConflictError(
            `Prior execution of operation "${idempotencyKey}" resulted in status ${existing.status} and requires manual reconciliation before retry.`
          );
        }
      }

      // 3. Record PENDING/RUNNING state durably
      const operationRecord: WorkflowOperationRecord = {
        id: randomUUID(),
        sessionId,
        idempotencyKey,
        operationType,
        requestPayloadHash: payloadHash,
        status: 'RUNNING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await this.persistence.saveOperation(operationRecord);

      return {
        lockAcquired: true,
        operationId: operationRecord.id,
      };
    } catch (err) {
      if (!(err instanceof OperationInProgressError)) {
        this.sessionLocks.delete(sessionId);
      }
      throw err;
    }
  }

  /**
   * Completes an operation with SUCCEEDED status and cached response payload.
   */
  async completeOperation(
    sessionId: string,
    idempotencyKey: string | undefined,
    responsePayload: unknown
  ): Promise<void> {
    try {
      if (idempotencyKey) {
        await this.persistence.updateOperationStatus(
          sessionId,
          idempotencyKey,
          'SUCCEEDED',
          responsePayload
        );
      }
    } finally {
      this.sessionLocks.delete(sessionId);
    }
  }

  /**
   * Marks an operation as FAILED, UNKNOWN, or REQUIRES_REVIEW and releases concurrency lock.
   */
  async failOperation(
    sessionId: string,
    idempotencyKey: string | undefined,
    status: WorkflowOperationStatus = 'FAILED',
    errorMessage?: string
  ): Promise<void> {
    try {
      if (idempotencyKey) {
        await this.persistence.updateOperationStatus(
          sessionId,
          idempotencyKey,
          status,
          undefined,
          errorMessage
        );
      }
    } finally {
      this.sessionLocks.delete(sessionId);
    }
  }

  /**
   * Forcibly releases session lock.
   */
  releaseLock(sessionId: string): void {
    this.sessionLocks.delete(sessionId);
  }
}

export const idempotencyService = new IdempotencyService();
