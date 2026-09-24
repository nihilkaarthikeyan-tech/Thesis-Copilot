-- ADR-0028: a share may let its holder edit a chapter live with the student.
ALTER TABLE "GuideShare" ADD COLUMN "canEdit" BOOLEAN NOT NULL DEFAULT false;
