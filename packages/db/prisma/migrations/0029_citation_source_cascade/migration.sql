-- Citation rows follow their source (2026-10-03, ADR-0045). The key was RESTRICT, so deleting a
-- source that any chapter cited failed outright; B.5 says the node stays and goes red, which
-- needs the row to go.

-- DropForeignKey
ALTER TABLE "Citation" DROP CONSTRAINT "Citation_sourceId_fkey";

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
