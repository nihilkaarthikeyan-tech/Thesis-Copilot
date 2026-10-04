-- ADR-0057: a Reader share — the thesis read-only, no comments. Existing shares stay commenters.
ALTER TABLE "GuideShare" ADD COLUMN "canComment" BOOLEAN NOT NULL DEFAULT true;

-- ADR-0057: "anyone with the link can read". One per document; only a hash of the token is kept.
-- CreateTable
CREATE TABLE "ShareLink" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "documentId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_documentId_key" ON "ShareLink"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_tokenHash_key" ON "ShareLink"("tokenHash");

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
