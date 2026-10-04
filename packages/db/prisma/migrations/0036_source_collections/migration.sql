-- 2026-10-04, from the Jenni study: collections (folders) in the library. A paper may be in any
-- number of them; deleting a collection removes only its memberships, never a paper.

-- CreateTable
CREATE TABLE "SourceCollection" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "documentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceCollectionItem" (
    "collectionId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceCollectionItem_pkey" PRIMARY KEY ("collectionId","sourceId")
);

-- CreateIndex
CREATE INDEX "SourceCollection_documentId_order_idx" ON "SourceCollection"("documentId", "order");

-- One name per thesis, whatever its case. Not in the Prisma schema (it cannot express an index on
-- an expression); the service checks first so the student gets a 409 naming the clash, and this
-- index settles a race between two tabs.
CREATE UNIQUE INDEX "SourceCollection_documentId_lower_name_key"
    ON "SourceCollection"("documentId", lower("name"));

-- CreateIndex
CREATE INDEX "SourceCollectionItem_sourceId_idx" ON "SourceCollectionItem"("sourceId");

-- AddForeignKey
ALTER TABLE "SourceCollection" ADD CONSTRAINT "SourceCollection_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceCollectionItem" ADD CONSTRAINT "SourceCollectionItem_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "SourceCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceCollectionItem" ADD CONSTRAINT "SourceCollectionItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
