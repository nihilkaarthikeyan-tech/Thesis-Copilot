-- ADR-0005: two actions PRD §8's enum does not name, so their calls can be logged truthfully.
-- (0006 added `Document.meta`; the enum values were meant to travel with it and did not.)

ALTER TYPE "AiAction" ADD VALUE 'PROPOSAL';
ALTER TYPE "AiAction" ADD VALUE 'CROSS_PAPER';
