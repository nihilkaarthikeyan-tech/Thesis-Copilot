-- Export fingerprints (2026-10-03, ADR-0044). A durable record of every thesis export and the
-- SHA-256 of its bytes, so the file a student hands in can be verified against what we produced.

-- CreateTable
CREATE TABLE "ExportArtifact" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "documentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "format" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportArtifact_documentId_createdAt_idx" ON "ExportArtifact"("documentId", "createdAt");

-- AddForeignKey
ALTER TABLE "ExportArtifact" ADD CONSTRAINT "ExportArtifact_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
