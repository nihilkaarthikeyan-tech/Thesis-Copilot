export {
  aiShare,
  type ChapterUsage,
  PROVENANCE_KINDS,
  type ProvenanceKind,
  totalWords,
  type UsageReport,
  usageToCsv,
  usageToDocx,
  type WordCounts,
} from './ai-usage.js';
export { captionOf, typedCaption, withCaption, withCaptionsResolved } from './captions.js';
export {
  CHECK_LABELS,
  type CheckId,
  type ComplianceChapter,
  type ComplianceFinding,
  type ComplianceInput,
  type ComplianceResult,
  figuresOf,
  headingsOf,
  runComplianceChecks,
} from './compliance.js';
export { chapterToDocx, type ExportOptions } from './docx.js';
export { escapeHtml, type HtmlExportInput, thesisToHtml } from './html.js';
export { fitToColumn, imageSize, MAX_FIGURE_WIDTH_PT, type Pixels } from './image-size.js';
export { type InvoiceInput, invoiceToDocx } from './invoice.js';
export {
  escapeLatex,
  type LatexExportInput,
  type LatexFile,
  thesisToLatexFiles,
  thesisToLatexZip,
} from './latex.js';
export {
  actionTaken,
  firstWords,
  type ResponseRow,
  type ResponseTableInput,
  responseTableToDocx,
} from './response-table.js';
export {
  pageSetupOf,
  renderLabel,
  type ThesisChapter,
  type ThesisExportInput,
  thesisToDocx,
  withoutPendingDrafts,
} from './thesis.js';
