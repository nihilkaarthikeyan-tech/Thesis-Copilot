-- 2026-10-08, Jenni build plan R30 (ADR-0116): more than one chat per thesis, and a chat that
-- answers only from one collection's papers.
--
-- Until now a thesis had one conversation, on "Document"."meta" -> 'chat' -> 'turns'. Each one that
-- has anything in it becomes the first thread of its thesis, word for word (the turns are copied
-- as they are, ids, citations and ratings included); then the old key is removed from "meta", so
-- the table is the one place a conversation lives. A cleared conversation ({"turns": []}) has
-- nothing to keep and becomes no thread. Tested in apps/api/test/chat-threads-migration.spec.ts.

-- CreateTable
CREATE TABLE "ChatThread" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "documentId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "collectionId" UUID,
    "collectionName" TEXT,
    "questions" INTEGER NOT NULL DEFAULT 0,
    "turns" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatThread_documentId_updatedAt_idx" ON "ChatThread"("documentId", "updatedAt");

-- AddForeignKey
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: deleting a collection keeps its chats; "collectionName" lets them say why they
-- can no longer be asked.
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "SourceCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The existing conversations. The title is the first question, its spaces collapsed, cut to 80
-- characters (the service titles a new thread the same way, at a word where it can). The thread
-- is dated by the thesis's last change, the nearest thing to "last asked" that was stored.
INSERT INTO "ChatThread" ("documentId", "title", "questions", "turns", "createdAt", "updatedAt")
SELECT
    d."id",
    COALESCE(
        NULLIF(
            left(
                btrim(regexp_replace(
                    (SELECT t.value ->> 'text'
                       FROM jsonb_array_elements(d."meta" -> 'chat' -> 'turns') WITH ORDINALITY AS t(value, n)
                      WHERE t.value ->> 'role' = 'user'
                      ORDER BY t.n
                      LIMIT 1),
                    '\s+', ' ', 'g')),
                80),
            ''),
        'Chat'),
    (SELECT count(*)::int
       FROM jsonb_array_elements(d."meta" -> 'chat' -> 'turns') AS t(value)
      WHERE t.value ->> 'role' = 'user'),
    d."meta" -> 'chat' -> 'turns',
    d."updatedAt",
    d."updatedAt"
FROM "Document" d
WHERE jsonb_typeof(d."meta" -> 'chat' -> 'turns') = 'array'
  AND jsonb_array_length(d."meta" -> 'chat' -> 'turns') > 0;

-- The old place, emptied only where nothing is left to lose: the conversation is now a thread,
-- or it was empty (or not a list, which the old code read as empty too).
UPDATE "Document" d SET "meta" = d."meta" - 'chat'
WHERE jsonb_typeof(d."meta") = 'object'
  AND (d."meta" -> 'chat') IS NOT NULL
  AND (
    jsonb_typeof(d."meta" -> 'chat' -> 'turns') IS DISTINCT FROM 'array'
    OR jsonb_array_length(d."meta" -> 'chat' -> 'turns') = 0
    OR EXISTS (SELECT 1 FROM "ChatThread" c WHERE c."documentId" = d."id")
  );
