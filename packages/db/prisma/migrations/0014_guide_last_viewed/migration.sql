-- When a guide last opened the thesis.
--
-- A supervisor opening a thesis for the second time wants one thing first: what has changed since
-- I last looked? Without this column the answer is unavailable, so the guide view could only ever
-- show a chapter list -- the same list, every visit, with no way to tell a rewritten chapter from
-- an untouched one.
--
-- Nullable, and null means "never opened it": the first visit correctly reports nothing as new
-- rather than reporting the entire thesis as new, which is true but useless.
ALTER TABLE "GuideShare" ADD COLUMN "lastViewedAt" TIMESTAMP(3);
