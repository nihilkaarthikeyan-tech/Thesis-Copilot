-- ADR-0056: the examiner review of a chapter the student wrote — a metered action of its own,
-- and the kind of CoherenceFlag it writes (one per issue, pinned to the sentence).
ALTER TYPE "AiAction" ADD VALUE 'EXAMINER_REVIEW';

ALTER TYPE "FlagType" ADD VALUE 'EXAMINER';
