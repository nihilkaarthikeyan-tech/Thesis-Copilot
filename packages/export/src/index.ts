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
export { fitToColumn, imageSize, MAX_FIGURE_WIDTH_PT, type Pixels } from './image-size.js';
export { type InvoiceInput, invoiceToDocx } from './invoice.js';
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
} from './thesis.js';
