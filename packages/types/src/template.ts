/**
 * Institution template spec — PRD Appendix D.3.1, PHASES v2 B3.1.
 *
 * The shape a university's formatting guideline is written down in. It is validated rather than
 * trusted because a template arrives as JSON somebody typed from a PDF: a missing margin or a
 * heading label with the wrong placeholder produces a thesis that is rejected at submission, and
 * the place to catch that is when the template is saved, not when the student exports at midnight.
 *
 * Every field carries the default from D.3.1's `EXAMPLE_IN_UNIVERSITY`, so a partial template is
 * usable and the gaps are visibly the example's values — which is what the export banner warns
 * about.
 */

import { z } from 'zod';

export const PAGE_SIZES = ['A4', 'Letter'] as const;

export const marginsSchema = z.object({
  top: z.number().min(0).max(100).default(25),
  bottom: z.number().min(0).max(100).default(25),
  left: z.number().min(0).max(100).default(38),
  right: z.number().min(0).max(100).default(25),
});

export const pageSchema = z.object({
  size: z.enum(PAGE_SIZES).default('A4'),
  marginsMm: marginsSchema.prefault({}),
});

export const fontSchema = z.object({
  body: z.string().min(1).default('Times New Roman'),
  sizePt: z.number().min(6).max(24).default(12),
  lineSpacing: z.number().min(1).max(3).default(1.5),
  paragraphSpacingPt: z.number().min(0).max(48).default(6),
  justify: z.boolean().default(true),
});

const headingBase = {
  sizePt: z.number().min(6).max(48),
  bold: z.boolean().default(true),
  italic: z.boolean().default(false),
  caps: z.boolean().default(false),
  align: z.enum(['left', 'center', 'right']).default('left'),
  pageBreakBefore: z.boolean().default(false),
};

export const headingsSchema = z.object({
  chapter: z
    .object({
      ...headingBase,
      sizePt: z.number().min(6).max(48).default(16),
      caps: z.boolean().default(true),
      align: z.enum(['left', 'center', 'right']).default('center'),
      pageBreakBefore: z.boolean().default(true),
      /** `CHAPTER {n}` — `{n}` is the chapter number. */
      label: z.string().default('CHAPTER {n}'),
    })
    .prefault({}),
  h2: z
    .object({
      ...headingBase,
      sizePt: z.number().min(6).max(48).default(14),
      /** `{chapter}.{n}` */
      numbering: z.string().default('{chapter}.{n}'),
    })
    .prefault({}),
  h3: z
    .object({
      ...headingBase,
      sizePt: z.number().min(6).max(48).default(12),
      numbering: z.string().default('{chapter}.{n}.{m}'),
    })
    .prefault({}),
});

export const numberingSchema = z.object({
  frontMatter: z.enum(['lowerRoman', 'upperRoman', 'decimal', 'none']).default('lowerRoman'),
  body: z.enum(['decimal', 'lowerRoman', 'none']).default('decimal'),
  bodyStartsAt: z.string().default('CHAPTER_1'),
  position: z
    .enum(['bottom-center', 'bottom-right', 'top-right', 'top-center'])
    .default('bottom-center'),
});

export const FRONT_MATTER_IDS = [
  'TITLE_PAGE',
  'CERTIFICATE',
  'DECLARATION',
  'ACKNOWLEDGEMENTS',
  'ABSTRACT',
  'TOC',
  'LIST_OF_FIGURES',
  'LIST_OF_TABLES',
  'ABBREVIATIONS',
] as const;
export type FrontMatterId = (typeof FRONT_MATTER_IDS)[number];

/** `true` always required, `false` optional, `"ifAny"` required when the thing it lists exists. */
export const requiredSchema = z.union([z.boolean(), z.literal('ifAny')]);

export const frontMatterSectionSchema = z.object({
  id: z.enum(FRONT_MATTER_IDS),
  required: requiredSchema.default(false),
  fields: z.array(z.string()).default([]),
  maxWords: z.number().int().positive().optional(),
});

export const captionSchema = z.object({
  figure: z
    .object({
      format: z.string().default('Figure {chapter}.{n}: {caption}'),
      position: z.enum(['above', 'below']).default('below'),
    })
    .prefault({}),
  table: z
    .object({
      format: z.string().default('Table {chapter}.{n}: {caption}'),
      position: z.enum(['above', 'below']).default('above'),
    })
    .prefault({}),
});

export const bibliographySchema = z.object({
  /** A style id from `@tc/citations`; the export renders with exactly this one. */
  style: z.string().default('ieee'),
  title: z.string().default('REFERENCES'),
  placement: z.enum(['END', 'PER_CHAPTER']).default('END'),
  pageBreakBefore: z.boolean().default(true),
});

export const templateSpecSchema = z.object({
  name: z.string().min(1).default('EXAMPLE_IN_UNIVERSITY'),
  page: pageSchema.prefault({}),
  font: fontSchema.prefault({}),
  headings: headingsSchema.prefault({}),
  numbering: numberingSchema.prefault({}),
  frontMatter: z.array(frontMatterSectionSchema).default([]),
  captions: captionSchema.prefault({}),
  bibliography: bibliographySchema.prefault({}),
  appendices: z
    .object({ label: z.string().default('APPENDIX {A}'), after: z.string().default('REFERENCES') })
    .prefault({}),
  headerFooter: z
    .object({ header: z.string().default(''), footer: z.string().default('') })
    .prefault({}),
  /** D.3.3's optional word bounds for the whole body. */
  minWords: z.number().int().positive().optional(),
  maxWords: z.number().int().positive().optional(),
});

export type TemplateSpec = z.infer<typeof templateSpecSchema>;
export type FrontMatterSection = z.infer<typeof frontMatterSectionSchema>;

/** Parses a stored spec, filling every default. Never throws: an unusable template is the example. */
export function readTemplateSpec(value: unknown): TemplateSpec {
  const parsed = templateSpecSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : templateSpecSchema.parse({});
}

/**
 * The fields a student fills once (D.3.2 step 1), stored on `Document.meta.thesisDetails`.
 *
 * Every one of them appears on a title page or a certificate, so an empty one is a blank on a
 * submitted document — which is what the compliance check exists to catch before it is printed.
 */
export const thesisDetailsSchema = z.object({
  studentName: z.string().trim().max(200).default(''),
  rollNo: z.string().trim().max(60).default(''),
  degree: z.string().trim().max(200).default(''),
  department: z.string().trim().max(200).default(''),
  institution: z.string().trim().max(300).default(''),
  guideName: z.string().trim().max(200).default(''),
  guideDesignation: z.string().trim().max(200).default(''),
  hodName: z.string().trim().max(200).default(''),
  monthYear: z.string().trim().max(60).default(''),
  /** ABSTRACT is front matter, not a chapter: it lives here so it is not a numbered chapter. */
  abstract: z.string().trim().max(20_000).default(''),
  acknowledgements: z.string().trim().max(20_000).default(''),
  /** `{ "PV": "photovoltaic" }` — the ABBREVIATIONS section, when the template asks for one. */
  abbreviations: z.record(z.string(), z.string()).prefault({}),
  declarationDate: z.string().trim().max(40).default(''),
});
export type ThesisDetails = z.infer<typeof thesisDetailsSchema>;

export function readThesisDetails(value: unknown): ThesisDetails {
  const parsed = thesisDetailsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : thesisDetailsSchema.parse({});
}

/** Which `ThesisDetails` field a front-matter `fields` entry names. */
export const FIELD_LABELS: Record<string, string> = {
  title: 'Thesis title',
  studentName: 'Your name',
  rollNo: 'Roll or registration number',
  degree: 'Degree',
  department: 'Department',
  institution: 'University or institution',
  guideName: 'Guide’s name',
  guideDesignation: 'Guide’s designation',
  hodName: 'Head of department',
  monthYear: 'Month and year of submission',
  date: 'Date',
  declarationDate: 'Date of the declaration',
};

/** A front-matter field in the student's words: "Your name", never `studentName`. */
export function fieldLabel(key: string): string {
  const known = FIELD_LABELS[key];
  if (known) return known;
  // A field an installed template names that we have no label for: split the camel case.
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
