export {
  type Autosave,
  type AutosaveOptions,
  type AutosaveStatus,
  createAutosave,
  type LocalDraft,
  type SaveResult,
} from './editor/autosave.js';
export {
  CITATIONS_RERENDER,
  Citation,
  type CitationAttrs,
  type CitationStorage,
  citationKeysInOrder,
  newCitationKey,
} from './editor/citation.js';
export {
  DraftBlock,
  type DraftBlockOptions,
  type DraftStatus,
  findDraft,
  pendingDraft,
} from './editor/draft-block.js';
export { type ThesisEditorOptions, thesisExtensions } from './editor/extensions.js';
export {
  type GhostEvent,
  type GhostRequestPayload,
  type GhostState,
  type GhostStatus,
  GhostText,
  type GhostTextOptions,
  getGhostState,
  ghostTextKey,
  jsonContainsText,
  type SuggestionCitation,
  type SuggestionOutcome,
  suggestionToFragment,
} from './editor/ghost-text.js';
export { MathBlock, MathInline } from './editor/math.js';
export {
  CommentAnchor,
  type ImageUpload,
  NeedsSourceNote,
  ThesisHeading,
  ThesisImage,
} from './editor/nodes.js';
export {
  AI_KINDS,
  PROVENANCE_KINDS,
  Provenance,
  type ProvenanceAttrs,
  type ProvenanceKind,
  provenancePluginKey,
  wordCountByProvenance,
} from './editor/provenance.js';
export { blockText, CHARS_PER_TOKEN, contextAround, documentText } from './editor/text.js';
