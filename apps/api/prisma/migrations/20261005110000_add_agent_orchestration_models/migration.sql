-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('IDLE', 'RUNNING', 'WAITING_FOR_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentStep" AS ENUM ('INITIALIZE', 'LOAD_CONTEXT', 'EVALUATE', 'GENERATE_APPLICATION', 'VALIDATE_APPLICATION', 'HUMAN_REVIEW', 'READY_FOR_SUBMISSION', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentDecision" AS ENUM ('CONTINUE', 'STOP', 'WAIT_FOR_HUMAN', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "userProfileId" UUID NOT NULL,
    "jobId" UUID,
    "applicationId" UUID,
    "status" "AgentStatus" NOT NULL DEFAULT 'IDLE',
    "currentStep" "AgentStep" NOT NULL DEFAULT 'INITIALIZE',
    "decision" "AgentDecision",
    "matchScore" INTEGER,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_events" (
    "id" UUID NOT NULL,
    "agentRunId" UUID NOT NULL,
    "step" "AgentStep" NOT NULL,
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_runs_userProfileId_idx" ON "agent_runs"("userProfileId");

-- CreateIndex
CREATE INDEX "agent_runs_jobId_idx" ON "agent_runs"("jobId");

-- CreateIndex
CREATE INDEX "agent_runs_applicationId_idx" ON "agent_runs"("applicationId");

-- CreateIndex
CREATE INDEX "agent_runs_status_idx" ON "agent_runs"("status");

-- CreateIndex
CREATE INDEX "agent_runs_createdAt_idx" ON "agent_runs"("createdAt");

-- CreateIndex
CREATE INDEX "agent_run_events_agentRunId_idx" ON "agent_run_events"("agentRunId");

-- CreateIndex
CREATE INDEX "agent_run_events_createdAt_idx" ON "agent_run_events"("createdAt");

-- CreateIndex
CREATE INDEX "agent_run_events_step_idx" ON "agent_run_events"("step");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
