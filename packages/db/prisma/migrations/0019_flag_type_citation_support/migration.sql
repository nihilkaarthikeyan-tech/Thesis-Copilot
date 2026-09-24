-- ADR-0023: the citation-support check's flags — whether the passage a sentence cites supports
-- what the sentence says it does. A new kind of CoherenceFlag, alongside the five PRD §8 defines.

ALTER TYPE "FlagType" ADD VALUE 'CITATION_SUPPORT';
