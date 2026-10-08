-- 2026-10-07, Jenni build plan R22 (ADR-0109): replies on comments, and a thumbs-up on a comment
-- or a reply (the emails of who gave one).

ALTER TABLE "Comment" ADD COLUMN "thumbs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "CommentReply" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "commentId" UUID NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "thumbs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    CONSTRAINT "CommentReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommentReply_commentId_createdAt_idx" ON "CommentReply"("commentId", "createdAt");

ALTER TABLE "CommentReply" ADD CONSTRAINT "CommentReply_commentId_fkey"
    FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
