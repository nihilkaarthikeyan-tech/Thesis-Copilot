export {
  type CatalogStyle,
  catalogSource,
  catalogStyle,
  searchCatalog,
  selectableCount,
} from './catalog.js';
export {
  type ChapterDoc,
  type CheckInput,
  type CitationCheckKind,
  type CitationFinding,
  citationNodesIn,
  type FoundCitationNode,
  notesIn,
  rekeyDuplicateCitations,
  runCitationChecks,
  untaggedCitationsIn,
} from './checks.js';
export { type CslItem, type CslName, namesFrom, type SourceLike, toCslItem } from './csl.js';
export {
  authorLines,
  DETAIL_TYPES,
  type DetailType,
  detailsOf,
  parseAuthorLines,
  type SourceDetails,
  withDetails,
} from './details.js';
export {
  citationKeys,
  csvField,
  exportLibrary,
  type LibraryFile,
  type LibraryFormat,
  type LibrarySource,
} from './library-export.js';
export {
  CITATION_LOCALES,
  type CitationLocale,
  citationLocaleFor,
  citationLocaleLabel,
  ensureLocalesRegistered,
  FALLBACK_LOCALE,
  isCitationLocale,
  isLocaleLoadable,
} from './locales.js';
export {
  previewStyle,
  SAMPLE_LABEL,
  SAMPLE_REFERENCE,
  type StylePreview,
} from './preview.js';
export {
  normaliseTitle,
  type ReferenceHealthFinding,
  type ReferenceHealthKind,
  referenceHealthHeadline,
  runReferenceHealth,
  type SourceForHealth,
  STALE_PREPRINT_YEARS,
  VENUE_CONCENTRATION,
} from './reference-health.js';
export {
  type BibliographyEntry,
  type CitationCluster,
  type CitationRef,
  type ClusterPlace,
  clusterPlaces,
  isNoteStyle,
  type RenderInput,
  type RenderResult,
  renderCitations,
} from './render.js';
export {
  DEFAULT_STYLE,
  findStyle,
  isKnownStyle,
  needsStyleXml,
  registerStyleXml,
  resolveStyle,
  STYLES,
  STYLES_DIR,
  type StyleEntry,
  type StyleFamily,
  StyleNotLoadedError,
  styleXml,
} from './styles.js';
