-- ADR-0006: per-user preferences.
--
-- FR-4.6 makes automatic-suggest an opt-in "per user", and FR-4.9's chat filters are a preference
-- the student sets once. PRD 8's User model has no place for either, and a column per preference
-- would mean a migration for every future one. One nullable JSON column, read only by the settings
-- endpoint and the editor.

ALTER TABLE "User" ADD COLUMN "settings" JSONB;
