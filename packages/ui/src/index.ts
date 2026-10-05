export {
  CHART_PALETTE,
  type ChartInput,
  drawChart,
  formatTick,
  niceTicks,
  parseCell,
  tableRowsAt,
  tableToChartInput,
} from './charts/index.js';
export {
  type DiagramLayout,
  drawDiagram,
  layoutDiagram,
  type PlacedNode,
  wrap,
} from './diagrams/index.js';
export {
  AI_TOKEN_RE,
  type AiCitation,
  type AiTextOptions,
  type AiToken,
  aiTextToFragment,
  aiTextToNodes,
  citationsInRange,
  type ExistingCitation,
  tokenizeAiText,
} from './editor/ai-text.js';
export {
  type Autosave,
  type AutosaveOptions,
  type AutosaveStatus,
  createAutosave,
  type LocalDraft,
  type SaveResult,
} from './editor/autosave.js';
export type { CitationOptions, CitationPassage } from './editor/citation.js';
export {
  CITATIONS_RERENDER,
  Citation,
  type CitationAttrs,
  type CitationStorage,
  citationKeysInOrder,
  newCitationKey,
} from './editor/citation.js';
export {
  applyCitationRole,
  type CitationRole,
  type SentenceForCitation,
  sentenceAroundCitation,
  sentenceToFragment,
} from './editor/citation-role.js';
export { CrossRef, type CrossRefOptions } from './editor/cross-ref.js';
export {
  DraftBlock,
  type DraftBlockOptions,
  type DraftStatus,
  findDraft,
  pendingDraft,
} from './editor/draft-block.js';
export { type ThesisEditorOptions, thesisExtensions } from './editor/extensions.js';
export { FOOTNOTE_MAX, Footnote } from './editor/footnote.js';
export {
  type CloseTo,
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
  setAutoSuggest,
  suggestionToFragment,
} from './editor/ghost-text.js';
export { insertBlockWithCaretAfter } from './editor/insert-block.js';
export {
  latexError,
  MATH_EDIT_EVENT,
  MathBlock,
  type MathEditDetail,
  MathInline,
  mathText,
} from './editor/math.js';
export {
  insertLatexAt,
  MATH_CHEAT_SHEET,
  MATH_EXAMPLES,
  type MathPattern,
} from './editor/math-patterns.js';
export {
  CommentAnchor,
  type ImageResolveUrl,
  type ImageUpload,
  type ImageUploadError,
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
export { newRefId, TableWithRef } from './editor/ref-ids.js';
export {
  collapse,
  findPassage,
  type ReviewAnchor,
  ReviewHighlights,
  type ReviewHighlightsOptions,
  reviewHighlightsKey,
  textIndexOf,
} from './editor/review.js';
export {
  attachSlashMenu,
  chooseSlashItem,
  closeSlashMenu,
  filterSlashItems,
  getSlashMenuState,
  moveSlashSelection,
  SLASH_ITEMS,
  type SlashItem,
  SlashMenu,
  type SlashMenuOptions,
  type SlashMenuState,
  type SlashMenuStorage,
  slashMenuKey,
  slashTrigger,
} from './editor/slash-menu.js';
export {
  CITEDNESS_EXPLAINED,
  type SourceMetricBadge,
  type SourceMetricFacts,
  sourceMetricBadges,
} from './editor/source-metrics.js';
export {
  blockText,
  CHARS_PER_TOKEN,
  contextAround,
  documentText,
  sectionUnderCursor,
} from './editor/text.js';
