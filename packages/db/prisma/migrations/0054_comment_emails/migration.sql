-- 2026-10-09, ADR-0142: comments and replies send an email.
--
-- One row per comment thread and person who can see it: when they were last emailed about the
-- thread (the hour's throttle) and the newest event already accounted for (what the next email
-- folds in). The off switch is `User.settings.emailOnComments`, JSON like ADR-0058's
-- `emailWhenJobDone`, so it needs no column. Erased with the comment, the thesis or the user.

-- CreateTable
CREATE TABLE "CommentEmailState" (
    "commentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lastSentAt" TIMESTAMP(3),
    "cursorAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommentEmailState_pkey" PRIMARY KEY ("commentId","userId")
);

-- CreateIndex
CREATE INDEX "CommentEmailState_userId_idx" ON "CommentEmailState"("userId");

-- AddForeignKey
ALTER TABLE "CommentEmailState" ADD CONSTRAINT "CommentEmailState_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentEmailState" ADD CONSTRAINT "CommentEmailState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
