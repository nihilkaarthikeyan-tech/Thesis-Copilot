-- 2026-10-05, ADR-0080: deep research in chat, metered as its own action (a planner call, one
-- search per part of the question, and a longer answer on the strong tier).

-- AlterEnum
ALTER TYPE "AiAction" ADD VALUE 'RESEARCH';
