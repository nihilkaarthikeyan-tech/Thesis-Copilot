/**
 * `PaperExtraction` — PRD §10.7.1, the structured result of reading an uploaded paper (A.5, FR-1.2).
 *
 * §10.7 puts the Zod schemas in `packages/types` (§7.3's one-line description of `packages/ai`
 * also mentions "schemas"; §10.7 is the specific instruction and wins). `packages/ai` builds the
 * prompt and validates against these.
 *
 * A.5 tells the model to use an empty string or empty array for anything it cannot find and never
 * to guess, so every optional field accepts `""` and is normalised to `undefined` on the way in.
 */

import { z } from 'zod';

/** Trims, and treats an empty string as absent. */
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional();

export const findingSchema = z.object({
  claim: z.string().trim().min(1),
  /** A.5: quotes the number, table or figure the paper gives; "" if none. */
  evidence: optionalText,
});

export const terminologySchema = z.object({
  term: z.string().trim().min(1),
  definition: z.string().trim(),
  /** How this paper uses the term, where that differs from general usage. */
  usageNote: optionalText,
});

export const referenceSchema = z.object({
  /** A.5: the raw string exactly as printed, including numbering. Never merged, split or corrected. */
  raw: z.string().trim().min(1),
  /** Only when a DOI is printed in the entry itself; resolution happens later (FR-2.1). */
  doi: optionalText,
});

export const paperSectionSchema = z.object({
  heading: z.string().trim().min(1),
  summary: z.string().trim(),
});

export const paperExtractionSchema = z.object({
  title: z.string().trim(),
  abstract: z.string().trim(),
  objectives: z.array(z.string().trim().min(1)).default([]),
  methodology: z.string().trim(),
  findings: z.array(findingSchema).default([]),
  terminology: z.array(terminologySchema).default([]),
  references: z.array(referenceSchema).default([]),
  sections: z.array(paperSectionSchema).default([]),
});

export type Finding = z.infer<typeof findingSchema>;
export type Terminology = z.infer<typeof terminologySchema>;
export type PaperReference = z.infer<typeof referenceSchema>;
export type PaperSection = z.infer<typeof paperSectionSchema>;
export type PaperExtraction = z.infer<typeof paperExtractionSchema>;

/** An extraction with nothing in it, used as the starting point when merging split parts. */
export const emptyExtraction = (): PaperExtraction => ({
  title: '',
  abstract: '',
  objectives: [],
  methodology: '',
  findings: [],
  terminology: [],
  references: [],
  sections: [],
});

/**
 * Gap analysis, FR-1.3: what the paper lacks that a thesis needs, and the reference gap.
 * Computed in code from the extraction, not asked of the model — it is arithmetic and a checklist,
 * and the PRD's AC is that it renders as an editable checklist on the proposal screen.
 */
export const THESIS_REFERENCE_RANGE = { min: 40, max: 60 } as const;

export type GapItem = {
  id: string;
  label: string;
  /** True when the paper already covers this. */
  present: boolean;
  detail: string;
};

export type GapAnalysis = {
  referenceCount: number;
  referenceTarget: { min: number; max: number };
  referenceGap: number;
  items: GapItem[];
};
