/**
 * Paper-to-thesis gap analysis — PRD FR-1.3.
 *
 *   "the system states what the paper lacks that a thesis needs (extended review, methodology
 *    justification, limitations, future work) and quantifies the reference gap ('12 cited;
 *    thesis-length review typically 40–60')"
 *   AC: "rendered as an editable checklist on the proposal screen."
 *
 * Derived in code from the extraction rather than asked of the model: it is a fixed checklist plus
 * arithmetic, so a model call would cost money and add a chance of invention for no benefit
 * (PRD §11 — a feature that cannot be metered and capped must not ship, and this needs neither).
 */

import type { GapAnalysis, GapItem, PaperExtraction } from './extraction.js';
import { THESIS_REFERENCE_RANGE } from './extraction.js';

/** Section headings that indicate a paper already covers one of the four thesis expectations. */
const SIGNALS: ReadonlyArray<{ id: string; label: string; patterns: RegExp; missing: string }> = [
  {
    id: 'literature-review',
    label: 'Extended literature review',
    patterns: /\b(literature reviews?|related works?|background|prior work|state of the art)\b/i,
    missing:
      'A thesis needs a chapter-length review. This paper has none, or only a short background section.',
  },
  {
    id: 'methodology-justification',
    label: 'Methodology justification',
    patterns:
      /\b(methods?|methodolog(?:y|ies)|materials and methods|research design|approach(?:es)?)\b/i,
    missing:
      'A thesis must justify why this method was chosen over the alternatives, not only describe it.',
  },
  {
    id: 'limitations',
    label: 'Limitations',
    patterns: /\b(limitations?|threats to validity|caveats?)\b/i,
    missing: 'A thesis states what the work cannot show and why.',
  },
  {
    id: 'future-work',
    label: 'Future work',
    patterns: /\b(future works?|further work|future research|recommendations?)\b/i,
    missing: 'A thesis closes with where the work goes next.',
  },
];

export function analyseGap(extraction: PaperExtraction): GapAnalysis {
  // Headings and their summaries are both searched: a paper may fold limitations into a discussion
  // section rather than giving it a heading of its own.
  const haystack = extraction.sections
    .map((s) => `${s.heading} ${s.summary}`)
    .concat(extraction.methodology)
    .join('\n');

  const items: GapItem[] = SIGNALS.map((signal) => {
    const present = signal.patterns.test(haystack);
    const matched = extraction.sections.find((s) => signal.patterns.test(s.heading));
    return {
      id: signal.id,
      label: signal.label,
      present,
      detail: present
        ? `Present${matched ? ` as "${matched.heading}"` : ''}. Expand it to thesis length.`
        : signal.missing,
    };
  });

  const referenceCount = extraction.references.length;
  const referenceGap = Math.max(THESIS_REFERENCE_RANGE.min - referenceCount, 0);

  items.push({
    id: 'reference-count',
    label: 'Reference count',
    present: referenceCount >= THESIS_REFERENCE_RANGE.min,
    detail:
      referenceGap > 0
        ? `${referenceCount} cited; a thesis-length review is typically ${THESIS_REFERENCE_RANGE.min}–${THESIS_REFERENCE_RANGE.max}. About ${referenceGap} more to find.`
        : `${referenceCount} cited, which is already in the ${THESIS_REFERENCE_RANGE.min}–${THESIS_REFERENCE_RANGE.max} range a thesis expects.`,
  });

  return {
    referenceCount,
    referenceTarget: THESIS_REFERENCE_RANGE,
    referenceGap,
    items,
  };
}

/**
 * The proposal skeleton (FR-1.4), pre-filled from the extraction. Every field is editable and
 * nothing is locked; the student's edits are what downstream prompts read, never these.
 */
export type ProposalScope = {
  workingTitle: string;
  problemStatement: string;
  objectives: string[];
  whyOpen: string;
};

export function draftScopeFrom(extraction: PaperExtraction): ProposalScope {
  return {
    workingTitle: extraction.title,
    // The abstract is the paper's own statement of the problem; the student rewrites it.
    problemStatement: firstSentences(extraction.abstract, 3),
    objectives: extraction.objectives,
    whyOpen: '',
  };
}

function firstSentences(text: string, count: number): string {
  const matches = text.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!matches) return text.trim();
  return matches.slice(0, count).join('').trim();
}
