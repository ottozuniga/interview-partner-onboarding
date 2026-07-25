-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('RUNNING', 'VALID', 'PARTIAL', 'INVALID', 'TRANSIENT_FAILURE');

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "liveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_sessions" (
    "id" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "partnerId" TEXT NOT NULL,
    "companyName" TEXT,
    "providerAccountId" TEXT,
    "providerApiKey" TEXT,
    "credentialsFingerprint" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_attempts" (
    "id" TEXT NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'RUNNING',
    "sessionId" TEXT NOT NULL,
    "credentialsFingerprint" TEXT NOT NULL,
    "reason" TEXT,
    "warnings" JSONB,
    "itemsSnapshot" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "validation_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partners_name_key" ON "partners"("name");

-- CreateIndex
CREATE INDEX "onboarding_sessions_partnerId_status_idx" ON "onboarding_sessions"("partnerId", "status");

-- CreateIndex
CREATE INDEX "validation_attempts_sessionId_startedAt_idx" ON "validation_attempts"("sessionId", "startedAt");

-- AddForeignKey
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_attempts" ADD CONSTRAINT "validation_attempts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "onboarding_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written partial unique indexes.
--
-- Prisma's schema language cannot express a WHERE clause on a unique index, so
-- these are added here and are invisible to `prisma db pull`. They are not
-- optimisations: they are the concurrency guarantees this system rests on.
-- Enforcing them in Postgres rather than in application code means a race
-- cannot slip between a SELECT and an INSERT.
-- ---------------------------------------------------------------------------

-- A partner has at most one open onboarding session. Makes "resume" a lookup
-- with exactly one answer, and makes a double-submitted session creation safe.
CREATE UNIQUE INDEX "one_open_session_per_partner"
    ON "onboarding_sessions" ("partnerId")
    WHERE "status" = 'IN_PROGRESS';

-- A session has at most one in-flight validation attempt. This is what makes
-- Validate idempotent: a concurrent second POST loses the INSERT race with a
-- unique violation, and is handed the winner's attempt instead of firing a
-- second Provider call.
CREATE UNIQUE INDEX "one_running_attempt_per_session"
    ON "validation_attempts" ("sessionId")
    WHERE "status" = 'RUNNING';
