-- ADR-0019: saved prompts, reused in chat with `/`.
--
-- A table rather than a key in `User.settings` (ADR-0006): these are the student's own content,
-- edited one at a time, and a JSON array rewritten whole loses a prompt whenever two tabs save.

CREATE TABLE "SavedPrompt" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedPrompt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavedPrompt_userId_idx" ON "SavedPrompt"("userId");

ALTER TABLE "SavedPrompt" ADD CONSTRAINT "SavedPrompt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
