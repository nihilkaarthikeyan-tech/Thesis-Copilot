/**
 * Thesis templates — PRD FR-3.1, PHASES v2 W8.1.
 *
 *   "Templates: `STEM_EMPIRICAL`, `QUALITATIVE`, `COMPILATION` (thesis by papers). Student picks;
 *    system suggests from field. Stored in `Document.template`."
 *
 * A template is the chapter shape A.9 is told to follow (`<template>`: name + expected chapter
 * list). It is a starting structure, not a rule: FR-3.4 lets the student rename, reorder, merge
 * and delete afterwards, and the outline they end with is what every prompt reads.
 *
 * The `role` on each chapter is what Phase 3's UNSUPPORTED_CLAIM check exempts by chapter kind
 * (A.12.3), so it is set here rather than inferred from a title later.
 */

export const TEMPLATES = ['STEM_EMPIRICAL', 'QUALITATIVE', 'COMPILATION'] as const;
export type Template = (typeof TEMPLATES)[number];

/** What a chapter is for. Used by the outline prompt and by later coherence checks. */
export type ChapterRole =
  | 'INTRODUCTION'
  | 'LITERATURE'
  | 'METHOD'
  | 'RESULTS'
  | 'DISCUSSION'
  | 'CONCLUSION'
  | 'PAPER';

export type TemplateChapter = {
  title: string;
  role: ChapterRole;
  /** One line for A.9's `<template>` block: what this chapter must establish. */
  intent: string;
  /** Typical share of the thesis word count; the outline UI shows it as guidance only. */
  share: number;
};

export type TemplateSpec = {
  key: Template;
  name: string;
  /** Shown in the picker under the name. */
  summary: string;
  /** A.9: "Do not add or remove top-level chapters unless <template> says the count is flexible." */
  flexibleChapterCount: boolean;
  chapters: readonly TemplateChapter[];
};

export const TEMPLATE_SPECS: Readonly<Record<Template, TemplateSpec>> = {
  STEM_EMPIRICAL: {
    key: 'STEM_EMPIRICAL',
    name: 'Empirical (science and engineering)',
    summary:
      'One study, reported once: introduction, literature, method, results, discussion, conclusion.',
    flexibleChapterCount: false,
    chapters: [
      {
        title: 'Introduction',
        role: 'INTRODUCTION',
        intent: 'State the problem, why it matters, the objectives and the scope of the study.',
        share: 0.1,
      },
      {
        title: 'Literature Review',
        role: 'LITERATURE',
        intent:
          'Review prior work by sub-theme, say what is established and what is not, and end at the gap this thesis addresses.',
        share: 0.25,
      },
      {
        title: 'Methodology',
        role: 'METHOD',
        intent:
          'Describe and justify the design, data, instruments and analysis so another researcher could repeat it.',
        share: 0.2,
      },
      {
        title: 'Results',
        role: 'RESULTS',
        intent: 'Report what was found, with tables and figures. Do not interpret here.',
        share: 0.2,
      },
      {
        title: 'Discussion',
        role: 'DISCUSSION',
        intent:
          'Interpret the results against the literature, state limitations honestly, and say what follows.',
        share: 0.17,
      },
      {
        title: 'Conclusion and Future Work',
        role: 'CONCLUSION',
        intent: 'Answer the objectives in order, state the contribution, and name the next steps.',
        share: 0.08,
      },
    ],
  },
  QUALITATIVE: {
    key: 'QUALITATIVE',
    name: 'Qualitative (social sciences and humanities)',
    summary:
      'Themes rather than a single results chapter: introduction, literature, theory, method, findings by theme, discussion, conclusion.',
    flexibleChapterCount: true,
    chapters: [
      {
        title: 'Introduction',
        role: 'INTRODUCTION',
        intent: 'State the research problem, the questions, the setting and the significance.',
        share: 0.1,
      },
      {
        title: 'Literature Review',
        role: 'LITERATURE',
        intent: 'Review the field by sub-theme and locate this study within it.',
        share: 0.22,
      },
      {
        title: 'Theoretical Framework',
        role: 'LITERATURE',
        intent:
          'Set out the concepts and theory the analysis uses, and why they fit this question.',
        share: 0.12,
      },
      {
        title: 'Methodology',
        role: 'METHOD',
        intent:
          'Describe the approach, participants, data collection, analysis, positionality and ethics.',
        share: 0.16,
      },
      {
        title: 'Findings',
        role: 'RESULTS',
        intent:
          'Present the themes with evidence from the data; one section per theme. Interpretation stays in the discussion.',
        share: 0.22,
      },
      {
        title: 'Discussion',
        role: 'DISCUSSION',
        intent: 'Read the themes against the literature and the framework; state limitations.',
        share: 0.12,
      },
      {
        title: 'Conclusion',
        role: 'CONCLUSION',
        intent: 'Answer the research questions, state the contribution and what should follow.',
        share: 0.06,
      },
    ],
  },
  COMPILATION: {
    key: 'COMPILATION',
    name: 'By publication (thesis by papers)',
    summary:
      'A framing introduction and synthesis around papers already written or submitted; one chapter per paper.',
    flexibleChapterCount: true,
    chapters: [
      {
        title: 'Introduction and Overview',
        role: 'INTRODUCTION',
        intent:
          'State the overarching problem, how the papers connect, and each paper’s contribution to it.',
        share: 0.15,
      },
      {
        title: 'Literature Review',
        role: 'LITERATURE',
        intent:
          'Review the field the papers sit in, at a level none of the individual papers covers.',
        share: 0.2,
      },
      {
        title: 'Paper I',
        role: 'PAPER',
        intent:
          'The first paper as a chapter, with a short preface saying where it fits and what changed.',
        share: 0.16,
      },
      {
        title: 'Paper II',
        role: 'PAPER',
        intent: 'The second paper as a chapter, with its preface.',
        share: 0.16,
      },
      {
        title: 'Paper III',
        role: 'PAPER',
        intent: 'The third paper as a chapter, with its preface.',
        share: 0.16,
      },
      {
        title: 'Synthesis and Conclusion',
        role: 'CONCLUSION',
        intent:
          'Draw the papers together into one argument, state the combined contribution and limitations, and name future work.',
        share: 0.17,
      },
    ],
  },
};

/**
 * FR-3.1: "system suggests from field". A field string is whatever the student typed on
 * `/app/new`, so this matches on words rather than a controlled list, and falls back to the
 * empirical shape — the commonest for the pilot's engineering and science students.
 */
export function suggestTemplate(field: string | null | undefined): Template {
  const f = (field ?? '').toLowerCase();
  if (!f.trim()) return 'STEM_EMPIRICAL';
  const qualitative = [
    'sociology',
    'anthropolog',
    'education',
    'literature',
    'history',
    'philosoph',
    'политич',
    'political',
    'social work',
    'media',
    'communicat',
    'gender',
    'cultural',
    'linguistic',
    'law',
    'management',
    'psycholog',
  ];
  const compilation = [
    'by publication',
    'by papers',
    'compilation',
    'article-based',
    'monograph-alternative',
  ];
  if (compilation.some((k) => f.includes(k))) return 'COMPILATION';
  if (qualitative.some((k) => f.includes(k))) return 'QUALITATIVE';
  return 'STEM_EMPIRICAL';
}

/** A.9's `<template>` block: the name and the expected chapter list. */
export function renderTemplateBlock(template: Template): string {
  const spec = TEMPLATE_SPECS[template];
  return [
    `<template name="${spec.name}" chapter_count="${spec.flexibleChapterCount ? 'flexible' : String(spec.chapters.length)}">`,
    ...spec.chapters.map((c) => `- ${c.title} — ${c.intent}`),
    '</template>',
  ].join('\n');
}
