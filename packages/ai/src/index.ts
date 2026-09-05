export {
  ASSIST,
  type AssistBuildInput,
  assistCachedBlock,
  assistUserMessage,
  buildAssistRequest,
  type PromptPassage,
} from './builder/assist.js';
export {
  buildCiteRequest,
  CITE,
  type CiteBuildInput,
  type CiteCandidate,
  type CiteResult,
  type ClaimReason,
  type ClaimVerdict,
  citeCandidateSchema,
  citeResultSchema,
  citeUserMessage,
  detectClaim,
  endsSentence,
  lastCompleteSentence,
  mockCiteResponse,
  usableCandidates,
} from './builder/cite.js';
export {
  buildDraftRequest,
  canDraft,
  countDraftWords,
  DRAFT,
  type DraftBuildInput,
  type DraftPostProcess,
  type DraftResult,
  type DraftSection,
  draftResultSchema,
  draftToProseMirror,
  draftUserMessage,
  mockDraftFor,
  NEEDS_SOURCE_RE,
  NO_SOURCES_MESSAGE,
  postProcessDraft,
} from './builder/draft.js';
export {
  buildMemoryBlock,
  type GlossaryEntry,
  MEMORY_BUDGET_TOKENS,
  type MemoryBlock,
  type MemoryInput,
  type MemoryScope,
  type MemoryTrim,
  renderOutline,
  type StyleProfile,
} from './builder/memory.js';
export {
  CITE_RE,
  cutAfterSecondSentence,
  type PostProcessInput,
  type PostProcessResult,
  postProcessAssist,
  removeLeadingOverlap,
  stripUnknownCitations,
} from './builder/postprocess.js';
export {
  buildProposalRequest,
  clarifiedTopic,
  type GapCheckInput,
  type GapCheckWork,
  MOCK_KEEP_ASKING,
  mayAskAnotherQuestion,
  mockProposalFor,
  PROPOSAL,
  type ProposalBuildInput,
  type ProposalReply,
  type ProposalSkeleton,
  type ProposalTurn,
  parseProposalReply,
  questionsAsked,
  renderGapCheck,
  SKELETON_INSTRUCTION,
  skeletonSchema,
} from './builder/proposal.js';
export { approxTokens, CHARS_PER_TOKEN, headByTokens, tailByTokens } from './builder/tokens.js';
export {
  buildCrossPaperRequest,
  type CrossPaperInput,
  type CrossPaperResult,
  crossPaperSchema,
  crossPaperUserMessage,
  type GlossaryValue,
  mergeTerminology,
  mockCrossPaperResponse,
  XPAPER,
} from './builder/xpaper.js';
export {
  buildExtractionRequest,
  buildExtractionUserMessage,
  DEFAULT_MAX_PART_CHARS,
  ExtractionFailed,
  type ExtractionPart,
  extractPaper,
  findReferenceSection,
  MAX_PARTS,
  mergeExtractions,
  splitForExtraction,
} from './extraction.js';
export { createProviders, type Providers } from './factory.js';
export {
  countSentences,
  formatGoldenReport,
  type GoldenFailure,
  type GoldenOutcome,
  type GoldenPassage,
  type GoldenScenario,
  goldenScenarioSchema,
  goldenSetSchema,
  judge,
} from './golden.js';
export {
  deriveExtraction,
  mockExtractionResponse,
  paperTextFromMessage,
} from './mock-extraction.js';
export {
  extractFencedBlocks,
  type LoadedPrompt,
  listPromptFiles,
  loadAllPrompts,
  loadPrompt,
  PROMPT_NAMES,
  PROMPTS_DIR,
  type PromptName,
} from './prompts.js';
export {
  AnthropicLlmProvider,
  type AnthropicProviderOptions,
  toTokenUsage,
  VoyageEmbeddingProvider,
} from './providers/anthropic.js';
export {
  type MockEmbeddingOptions,
  MockEmbeddingProvider,
  MockLlmProvider,
  type MockProviderOptions,
  type MockResponse,
} from './providers/mock.js';
export { renderTemplate, type TemplateData } from './template.js';
export {
  type AiAction,
  type EmbeddingProvider,
  type LlmChunk,
  type LlmProvider,
  LlmProviderError,
  type LlmRequest,
  type LlmResult,
  LlmValidationError,
  type Message,
  type Tier,
  type TokenUsage,
} from './types.js';
