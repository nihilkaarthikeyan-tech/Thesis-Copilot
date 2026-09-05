-- ADR-0004: one table for the events no other table records.
--
-- PHASES 5.9 wants "reset caps (logged)" and 5.10 counts "cap-exceeded events"; neither has a home
-- in PRD §8, where a cap refusal leaves no row (UsageLedger only counts what was served) and an
-- admin action leaves nothing at all. `kind` is text so a new kind needs no migration.

CREATE TABLE "AuditEvent" (
    "id"         UUID NOT NULL DEFAULT uuid_generate_v7(),
    "kind"       TEXT NOT NULL,
    "userId"     UUID NOT NULL,
    "actorId"    UUID,
    "documentId" UUID,
    "detail"     JSONB,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_kind_createdAt_idx" ON "AuditEvent"("kind", "createdAt");
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");
