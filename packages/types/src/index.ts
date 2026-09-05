export {
  emptyExtraction,
  type Finding,
  findingSchema,
  type GapAnalysis,
  type GapItem,
  type PaperExtraction,
  type PaperReference,
  type PaperSection,
  paperExtractionSchema,
  paperSectionSchema,
  referenceSchema,
  type Terminology,
  THESIS_REFERENCE_RANGE,
  terminologySchema,
} from './extraction.js';
export { analyseGap, draftScopeFrom, type ProposalScope } from './gap.js';
