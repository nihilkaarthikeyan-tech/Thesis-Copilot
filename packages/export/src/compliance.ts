/**
 * Compliance checklist — PRD Appendix D.3.3, PHASES v2 B3.4.
 *
 *   "deterministic; runs before export and shows pass/fail … A failing check blocks PDF export
 *    (not `.docx`) until fixed or explicitly overridden with a reason that is written to the
 *    export log."
 *
 * Deterministic is the whole point: no model is involved, so every failure names the thing that is
 * wrong and where. A student is going to act on these at midnight before a submission deadline,
 * and a check that says "something looks off" is worse than no check.
 *
 * `.docx` is never blocked — a student must always be able to get their own words out of the
 * product (§12.2). It is the PDF, the thing they hand in, that waits.
 */

import type { TemplateSpec, ThesisDetails } from '@tc/types';
import { captionOf, withCaptionsResolved } from './captions.js';

export type CheckId =
  | 'FRONT_MATTER'
  | 'TITLE_PAGE_FIELDS'
  | 'ABSTRACT_LENGTH'
  | 'CHAPTER_HEADINGS'
  | 'HEADING_NUMBERING'
  | 'FIGURES_TABLES'
  | 'TOC_CONSISTENCY'
  | 'CITATIONS'
  | 'PAGE_SETUP'
  | 'WORD_COUNT';

export type ComplianceFinding = {
  check: CheckId;
  /** What is wrong, in the words the student reads. */
  message: string;
  chapterTitle?: string;
};

export type ComplianceResult = {
  passed: boolean;
  checks: Array<{ check: CheckId; label: string; passed: boolean; findings: ComplianceFinding[] }>;
  findings: ComplianceFinding[];
};

export const CHECK_LABELS: Record<CheckId, string> = {
  FRONT_MATTER: 'Required front matter is present',
  TITLE_PAGE_FIELDS: 'Every front-matter field is filled',
  ABSTRACT_LENGTH: 'The abstract is within its word limit',
  CHAPTER_HEADINGS: 'Each chapter starts with one level-1 heading',
  HEADING_NUMBERING: 'Headings run in order with no gaps',
  FIGURES_TABLES: 'Figures and tables are captioned, numbered and referred to',
  TOC_CONSISTENCY: 'The contents list matches the headings',
  CITATIONS: 'Citations resolve and the bibliography is not empty',
  PAGE_SETUP: 'Page size, margins, font and spacing match the template',
  WORD_COUNT: 'The thesis is within the template’s word bounds',
};

export type ComplianceChapter = {
  id: string;
  title: string;
  order: number;
  content: unknown;
};

export type ComplianceInput = {
  spec: TemplateSpec;
  details: ThesisDetails;
  documentTitle: string;
  chapters: readonly ComplianceChapter[];
  /** From the citation layer: what the whole document cites and what is orphaned. */
  citations: { orphans: number; bibliographyEntries: number; style: string };
  /** The page setup the generated `.docx` actually carries; absent before the file is built. */
  actualPageSetup?: {
    pageSize: string;
    marginsMm: { top: number; bottom: number; left: number; right: number };
    fontName: string;
    fontSizePt: number;
    lineSpacing: number;
  };
};

type Node = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
};

export type Heading = { level: number; text: string; chapterTitle: string };
export type Figure = { kind: 'figure' | 'table'; caption: string | null; chapterTitle: string };

/** Every heading in a chapter, in order. */
export function headingsOf(chapter: ComplianceChapter): Heading[] {
  const out: Heading[] = [];
  const textOf = (node: Node | undefined): string =>
    !node
      ? ''
      : node.type === 'text'
        ? (node.text ?? '')
        : (node.content ?? []).map(textOf).join('');
  const walk = (node: Node | undefined) => {
    if (!node) return;
    if (node.type === 'heading') {
      out.push({
        level: Number(node.attrs?.level ?? 2),
        text: textOf(node).trim(),
        chapterTitle: chapter.title,
      });
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(chapter.content as Node);
  return out;
}

/**
 * Images and tables with their captions — the node's own, or a caption-shaped paragraph beside
 * it, exactly as the exporters read them (`withCaptionsResolved`). The check and the file it
 * checks now agree on what a caption is; before, the check took any paragraph beginning "Figure"
 * as one while the exporter printed the file name.
 */
export function figuresOf(chapter: ComplianceChapter): Figure[] {
  const out: Figure[] = [];
  const resolved = withCaptionsResolved(chapter.content) as Node | undefined;
  for (const block of resolved?.content ?? []) {
    const kind = block.type === 'image' ? 'figure' : block.type === 'table' ? 'table' : null;
    if (!kind) continue;
    const caption = captionOf(block);
    out.push({ kind, caption: caption || null, chapterTitle: chapter.title });
  }
  return out;
}

/** Plain text of a chapter, in document order. */
function plainText(chapter: ComplianceChapter): string {
  const parts: string[] = [];
  const walk = (node: Node | undefined) => {
    if (!node) return;
    if (node.type === 'text' && node.text) parts.push(node.text);
    for (const child of node.content ?? []) walk(child);
  };
  walk(chapter.content as Node);
  return parts.join(' ');
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Whether an `ifAny` front-matter section is required for this document. */
function sectionApplies(id: string, figures: readonly Figure[], details: ThesisDetails): boolean {
  if (id === 'LIST_OF_FIGURES') return figures.some((f) => f.kind === 'figure');
  if (id === 'LIST_OF_TABLES') return figures.some((f) => f.kind === 'table');
  if (id === 'ABBREVIATIONS') return Object.keys(details.abbreviations).length > 0;
  return true;
}

/** Does the document have content for this front-matter section? */
/** "TITLE_PAGE" → "title page", for a message a student reads. */
function sectionName(id: string): string {
  return id.replace(/_/g, ' ').toLowerCase();
}

function sectionHasContent(
  id: string,
  details: ThesisDetails,
  documentTitle: string,
  figures: readonly Figure[],
): boolean {
  switch (id) {
    case 'TITLE_PAGE':
      return documentTitle.trim().length > 0 && details.studentName.trim().length > 0;
    case 'CERTIFICATE':
      // Both names are printed on it, and both are signed for.
      return details.guideName.trim().length > 0 && details.hodName.trim().length > 0;
    case 'DECLARATION':
      return details.studentName.trim().length > 0 && details.declarationDate.trim().length > 0;
    case 'ACKNOWLEDGEMENTS':
      return details.acknowledgements.trim().length > 0;
    case 'ABSTRACT':
      return details.abstract.trim().length > 0;
    case 'ABBREVIATIONS':
      return Object.keys(details.abbreviations).length > 0;
    // TOC, LOF and LOT are generated from the document, so they exist whenever their contents do.
    case 'TOC':
      return true;
    case 'LIST_OF_FIGURES':
      return figures.some((f) => f.kind === 'figure');
    case 'LIST_OF_TABLES':
      return figures.some((f) => f.kind === 'table');
    default:
      return true;
  }
}

/** D.3.3, in order. Each check contributes its own findings; none of them stops the others. */
export function runComplianceChecks(input: ComplianceInput): ComplianceResult {
  const { spec, details, chapters } = input;
  const figures = chapters.flatMap(figuresOf);
  const headings = chapters.flatMap(headingsOf);
  const findingsBy = new Map<CheckId, ComplianceFinding[]>();
  const add = (check: CheckId, message: string, chapterTitle?: string) => {
    findingsBy.set(check, [
      ...(findingsBy.get(check) ?? []),
      { check, message, ...(chapterTitle ? { chapterTitle } : {}) },
    ]);
  };

  // 1. Required front matter.
  for (const section of spec.frontMatter) {
    const required =
      section.required === true ||
      (section.required === 'ifAny' && sectionApplies(section.id, figures, details));
    if (!required) continue;
    if (!sectionHasContent(section.id, details, input.documentTitle, figures)) {
      add(
        'FRONT_MATTER',
        `${section.id.replace(/_/g, ' ').toLowerCase()} is required by this template and has no content yet.`,
      );
    }
  }

  // 2. The fields every required front-matter section names.
  //
  // Every section's `fields`, not just the title page's: the certificate names `hodName` and the
  // declaration names a date, and a blank in either is printed on a page the department signs.
  // The check keeps D.3.3's id, which was written when the title page was the only one listed.
  const seenFields = new Set<string>();
  for (const section of spec.frontMatter) {
    if (section.required === false) continue;
    for (const field of section.fields) {
      // The example template writes the declaration's date as `date`; `ThesisDetails` calls it
      // `declarationDate`. Alias rather than rename, so an installed template keeps working.
      const key = field === 'date' ? 'declarationDate' : field;
      if (seenFields.has(key)) continue;
      seenFields.add(key);
      const value =
        key === 'title'
          ? input.documentTitle
          : ((details as unknown as Record<string, unknown>)[key] as string | undefined);
      if (!String(value ?? '').trim()) {
        add('TITLE_PAGE_FIELDS', `The ${sectionName(section.id)} needs “${key}”, which is empty.`);
      }
    }
  }

  // 3. Abstract length.
  const abstractSection = spec.frontMatter.find((section) => section.id === 'ABSTRACT');
  if (abstractSection?.maxWords) {
    const words = countWords(details.abstract);
    if (words > abstractSection.maxWords) {
      add(
        'ABSTRACT_LENGTH',
        `The abstract is ${words} words; this template allows ${abstractSection.maxWords}.`,
      );
    }
  }

  // 4. Chapter headings: one level-1 per chapter, and no others.
  for (const chapter of chapters) {
    const own = headingsOf(chapter);
    const level1 = own.filter((h) => h.level === 1);
    if (level1.length === 0) {
      add('CHAPTER_HEADINGS', 'This chapter has no level-1 heading.', chapter.title);
    } else if (level1.length > 1) {
      add(
        'CHAPTER_HEADINGS',
        `This chapter has ${level1.length} level-1 headings; a chapter has exactly one.`,
        chapter.title,
      );
    }
  }

  // 5. Heading numbering: levels never skip (an h3 directly under an h1).
  for (const chapter of chapters) {
    let previous = 1;
    for (const heading of headingsOf(chapter)) {
      if (heading.level > previous + 1) {
        add(
          'HEADING_NUMBERING',
          `“${heading.text}” is a level-${heading.level} heading directly under a level-${previous}; a level is missing between them.`,
          chapter.title,
        );
      }
      previous = heading.level;
    }
  }

  // 6. Figures and tables: captioned, and referred to in the text.
  // The search runs over the text as the exporters print it, with every typed caption moved into
  // its figure (`withCaptionsResolved`): a caption reads "Figure 1.1: Drying curve", the very
  // phrase the search looks for, and counting it would let every captioned figure pass whether
  // the prose mentions it or not — the check defeated by the thing it checks. A sentence that
  // legitimately begins "Figure 1 shows…" is prose to `typedCaption` and stays in.
  const allText = chapters
    .map((c) => plainText({ ...c, content: withCaptionsResolved(c.content) }))
    .join(' ');
  for (const chapter of chapters) {
    for (const item of figuresOf(chapter)) {
      if (!item.caption) {
        add('FIGURES_TABLES', `A ${item.kind} has no caption.`, chapter.title);
      }
    }
  }
  const referenced = (kind: 'figure' | 'table', n: number) =>
    new RegExp(`\\b${kind}\\s+\\d+\\.${n}\\b|\\b${kind}\\s+${n}\\b`, 'i').test(allText);
  ['figure', 'table'].forEach((kind) => {
    const items = figures.filter((f) => f.kind === kind);
    items.forEach((item, i) => {
      if (!referenced(kind as 'figure' | 'table', i + 1)) {
        add(
          'FIGURES_TABLES',
          `${kind === 'figure' ? 'Figure' : 'Table'} ${i + 1}${item.caption ? ` (“${item.caption.slice(0, 40)}…”)` : ''} is never referred to in the text.`,
          item.chapterTitle,
        );
      }
    });
  });

  // 7. TOC consistency: the computed heading list against the chapters it should contain.
  const chapterTitles = chapters.map((c) => c.title.trim()).filter(Boolean);
  const level1Texts = headings.filter((h) => h.level === 1).map((h) => h.text.trim());
  for (const title of chapterTitles) {
    if (!level1Texts.some((text) => text.toLowerCase() === title.toLowerCase())) {
      add(
        'TOC_CONSISTENCY',
        `The contents list would say “${title}”, but the chapter’s own heading reads differently. Rename one so they agree.`,
        title,
      );
    }
  }

  // 8. Citations.
  if (input.citations.orphans > 0) {
    add(
      'CITATIONS',
      `${input.citations.orphans} citation${input.citations.orphans === 1 ? '' : 's'} point at a source that is no longer in your library.`,
    );
  }
  if (input.citations.bibliographyEntries === 0) {
    add('CITATIONS', 'Nothing is cited, so the bibliography would be empty.');
  }
  if (input.citations.style !== spec.bibliography.style) {
    add(
      'CITATIONS',
      `This template requires the ${spec.bibliography.style} style; the thesis is set to ${input.citations.style}.`,
    );
  }

  // 9. Page setup, asserted on what was actually generated.
  const actual = input.actualPageSetup;
  if (actual) {
    if (actual.pageSize !== spec.page.size) {
      add('PAGE_SETUP', `The file is ${actual.pageSize}; the template requires ${spec.page.size}.`);
    }
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      const want = spec.page.marginsMm[side];
      const got = actual.marginsMm[side];
      if (Math.abs(want - got) > 0.6) {
        add('PAGE_SETUP', `The ${side} margin is ${got} mm; the template requires ${want} mm.`);
      }
    }
    if (actual.fontName !== spec.font.body) {
      add(
        'PAGE_SETUP',
        `The body font is ${actual.fontName}; the template requires ${spec.font.body}.`,
      );
    }
    if (Math.abs(actual.fontSizePt - spec.font.sizePt) > 0.1) {
      add(
        'PAGE_SETUP',
        `The body text is ${actual.fontSizePt} pt; the template requires ${spec.font.sizePt} pt.`,
      );
    }
    if (Math.abs(actual.lineSpacing - spec.font.lineSpacing) > 0.05) {
      add(
        'PAGE_SETUP',
        `Line spacing is ${actual.lineSpacing}; the template requires ${spec.font.lineSpacing}.`,
      );
    }
  }

  // 10. Word count, when the template sets bounds.
  const bodyWords = chapters.reduce((n, c) => n + countWords(plainText(c)), 0);
  if (spec.minWords && bodyWords < spec.minWords) {
    add(
      'WORD_COUNT',
      `The body is ${bodyWords} words; this template asks for at least ${spec.minWords}.`,
    );
  }
  if (spec.maxWords && bodyWords > spec.maxWords) {
    add(
      'WORD_COUNT',
      `The body is ${bodyWords} words; this template allows at most ${spec.maxWords}.`,
    );
  }

  const ids = Object.keys(CHECK_LABELS) as CheckId[];
  const checks = ids.map((check) => ({
    check,
    label: CHECK_LABELS[check],
    findings: findingsBy.get(check) ?? [],
    passed: (findingsBy.get(check) ?? []).length === 0,
  }));
  const findings = checks.flatMap((c) => c.findings);
  return { passed: findings.length === 0, checks, findings };
}
