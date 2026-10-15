-- CreateEnum
CREATE TYPE "MatchRecommendation" AS ENUM ('APPLY', 'CONSIDER', 'LOW_PRIORITY', 'DO_NOT_APPLY');

-- CreateTable
CREATE TABLE "job_matches" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "userProfileId" UUID NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "skillScore" INTEGER NOT NULL,
    "experienceScore" INTEGER NOT NULL,
    "roleScore" INTEGER NOT NULL,
    "preferenceScore" INTEGER NOT NULL,
    "locationScore" INTEGER NOT NULL,
    "recommendation" "MatchRecommendation" NOT NULL,
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gaps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiAnalysis" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_matches_jobId_idx" ON "job_matches"("jobId");

-- CreateIndex
CREATE INDEX "job_matches_userProfileId_idx" ON "job_matches"("userProfileId");

-- CreateIndex
CREATE INDEX "job_matches_overallScore_idx" ON "job_matches"("overallScore");

-- CreateIndex
CREATE INDEX "job_matches_recommendation_idx" ON "job_matches"("recommendation");

-- CreateIndex
CREATE UNIQUE INDEX "job_matches_jobId_userProfileId_key" ON "job_matches"("jobId", "userProfileId");

-- AddForeignKey
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_userProfileId_fkey" FOREIGN KEY ("userProfileId") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
