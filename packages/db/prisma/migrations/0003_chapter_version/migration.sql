-- ADR-0003: columns Appendix B needs on Chapter that PRD §8 does not define.
--   version     optimistic-concurrency counter for PUT /chapters/:id (B.7: 409 on stale baseVersion)
--   wordCounts  per-provenance word counts computed on save (B.4; feeds FR-8.6)
--   snapshotAt  when the last DocumentVersion snapshot was taken (B.7: snapshot every >= 10 min)
ALTER TABLE "Chapter"
  ADD COLUMN "version"    INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "wordCounts" JSONB,
  ADD COLUMN "snapshotAt" TIMESTAMP(3);
