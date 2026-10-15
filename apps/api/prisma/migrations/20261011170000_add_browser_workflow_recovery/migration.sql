-- CreateTable
CREATE TABLE "browser_workflow_runs" (
    "id" UUID NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userProfileId" UUID,
    "status" TEXT NOT NULL DEFAULT 'INITIALIZING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "currentStepIndex" INTEGER NOT NULL DEFAULT 1,
    "currentStepId" TEXT NOT NULL,
    "currentStepHeading" TEXT,
    "currentUrl" TEXT NOT NULL,
    "workflowState" JSONB NOT NULL,
    "recoveryStatus" TEXT,
    "lastReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "browser_workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "browser_workflow_operations" (
    "id" UUID NOT NULL,
    "workflowRunId" UUID,
    "sessionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "requestPayloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "responsePayload" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "browser_workflow_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "browser_workflow_runs_sessionId_key" ON "browser_workflow_runs"("sessionId");

-- CreateIndex
CREATE INDEX "browser_workflow_runs_sessionId_idx" ON "browser_workflow_runs"("sessionId");

-- CreateIndex
CREATE INDEX "browser_workflow_runs_status_idx" ON "browser_workflow_runs"("status");

-- CreateIndex
CREATE INDEX "browser_workflow_runs_createdAt_idx" ON "browser_workflow_runs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "browser_workflow_operations_sessionId_idempotencyKey_key" ON "browser_workflow_operations"("sessionId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "browser_workflow_operations_sessionId_idx" ON "browser_workflow_operations"("sessionId");

-- CreateIndex
CREATE INDEX "browser_workflow_operations_idempotencyKey_idx" ON "browser_workflow_operations"("idempotencyKey");

-- CreateIndex
CREATE INDEX "browser_workflow_operations_status_idx" ON "browser_workflow_operations"("status");

-- CreateIndex
CREATE INDEX "browser_workflow_operations_createdAt_idx" ON "browser_workflow_operations"("createdAt");

-- AddForeignKey
ALTER TABLE "browser_workflow_runs" ADD CONSTRAINT "browser_workflow_runs_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES "user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_workflow_operations" ADD CONSTRAINT "browser_workflow_operations_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "browser_workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
