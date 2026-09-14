-- Account deletion — PRD 12.2: "hard-delete documents, sources, chunks, files within 30 days;
-- keep billing records as required by law."
--
-- Two timestamps, because they are two different facts. `deletionRequestedAt` is the student
-- asking; `deletedAt` is the erasure having run. The gap between them is the grace period, which
-- exists because sign-in is a code emailed to an address -- so "someone else read one email" is
-- the whole of what stands between an attacker and an irreversible request.
--
-- The row itself survives the erasure, stripped: the billing records 12.2 requires us to keep
-- have foreign keys into it, and an orphaned invoice proves nothing.
ALTER TABLE "User" ADD COLUMN "deletionRequestedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- The scheduler's only query is "who is due", every ten minutes, forever.
CREATE INDEX "User_deletionRequestedAt_idx" ON "User"("deletionRequestedAt");
