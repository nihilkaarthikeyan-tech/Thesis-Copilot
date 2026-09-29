-- Admin controls (2026-09-29): suspension, extra allowance, feedback status.
ALTER TABLE "User" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "suspendedReason" TEXT;

ALTER TABLE "UsageLedger" ADD COLUMN "bonus" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "FeedbackState" (
    "auditEventId" UUID NOT NULL,
    "readAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "answeredBy" UUID,

    CONSTRAINT "FeedbackState_pkey" PRIMARY KEY ("auditEventId")
);
