-- 2026-10-09, ADR-0139: remove the copies the find-sources race already made.
--
-- Two `find-sources` runs a few seconds apart both read the library before either inserted, and
-- added the same papers twice. The second copy's `resolve-reference` job had the first's id, so
-- BullMQ dropped it and the copy stayed PENDING ("Looking it up…") for good. Inserts now take a
-- per-thesis advisory lock (`addSourcesOnce`, @tc/db), so no new copies are made; this clears the
-- old ones.
--
-- A PENDING source goes when a RESOLVED source in the same thesis has the same DOI, the same
-- normalised title or the same reference line, and the copy is more than ten minutes old (its
-- resolution is not merely still running). Never one that is cited, pinned, filed in a
-- collection, highlighted, has passages, or whose id appears in a chapter: those stay for the
-- student to merge. The same rule as `removeStrandedDuplicateSources`, which `find-sources` also
-- runs for its thesis. Idempotent.

DELETE FROM "Source" p
WHERE p.status = 'PENDING'
  AND p."createdAt" < (now() AT TIME ZONE 'UTC') - interval '10 minutes'
  AND EXISTS (
    SELECT 1 FROM "Source" r
    WHERE r."documentId" = p."documentId"
      AND r.id <> p.id
      AND r.status = 'RESOLVED'
      AND (
        (p.doi IS NOT NULL AND r.doi IS NOT NULL AND lower(r.doi) = lower(p.doi))
        OR (
          p.title IS NOT NULL AND r.title IS NOT NULL
          AND btrim(regexp_replace(lower(p.title), '[^a-z0-9]+', ' ', 'g')) <> ''
          AND btrim(regexp_replace(lower(r.title), '[^a-z0-9]+', ' ', 'g'))
            = btrim(regexp_replace(lower(p.title), '[^a-z0-9]+', ' ', 'g'))
        )
        OR (p."rawReference" IS NOT NULL AND r."rawReference" = p."rawReference")
      )
  )
  AND NOT EXISTS (SELECT 1 FROM "Citation" c WHERE c."sourceId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "ChapterSourcePin" s WHERE s."sourceId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "SourceCollectionItem" i WHERE i."sourceId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "SourceHighlight" h WHERE h."sourceId" = p.id)
  AND NOT EXISTS (SELECT 1 FROM "SourceChunk" k WHERE k."sourceId" = p.id)
  AND NOT EXISTS (
    SELECT 1 FROM "Chapter" ch
    WHERE ch."documentId" = p."documentId" AND ch.content::text LIKE '%' || p.id::text || '%'
  );
