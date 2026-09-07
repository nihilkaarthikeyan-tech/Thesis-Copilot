-- ADR-0007: a coherence flag needs an identity that survives a re-run.
--
-- Appendix D.1.1 requires a run to "delete previous OPEN flags whose fingerprint is not reproduced,
-- keep RESOLVED/IGNORED flags, and skip re-creating a flag whose fingerprint matches an IGNORED
-- one". PRD section 8's model has no column for that identity, and it cannot be derived after the
-- fact: the fingerprint is over the flagged text as it was when the flag was raised, and the
-- student has edited it since. D.1.3's Ignore takes an optional reason, which likewise has nowhere
-- to live.

ALTER TABLE "CoherenceFlag" ADD COLUMN "fingerprint" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CoherenceFlag" ADD COLUMN "ignoreReason" TEXT;

CREATE INDEX "CoherenceFlag_documentId_fingerprint_idx"
  ON "CoherenceFlag"("documentId", "fingerprint");
