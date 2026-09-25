-- ADR-0030: viva preparation — a metered action of its own, and the questions it asks.
ALTER TYPE "AiAction" ADD VALUE 'VIVA';

-- CreateTable
CREATE TABLE "VivaQuestion" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "documentId" UUID NOT NULL,
    "setId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "probing" TEXT NOT NULL,
    "chapterId" UUID NOT NULL,
    "passage" TEXT NOT NULL,
    "from" INTEGER NOT NULL,
    "to" INTEGER NOT NULL,
    "answer" TEXT,
    "feedback" JSONB,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VivaQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VivaQuestion_documentId_setId_idx" ON "VivaQuestion"("documentId", "setId");

-- AddForeignKey
ALTER TABLE "VivaQuestion" ADD CONSTRAINT "VivaQuestion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
