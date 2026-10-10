/**
 * ADR-0145: the "Set up this thesis" card inside the editor. A new thesis opens on its first
 * chapter at once, and the card sets it up in four rows (title, sources, field and university;
 * aim; chapters; first line — ADR-0151 folded the field row into the first). Its state lives on `Document.meta.setup`, so it follows the student to another
 * device and is never shown on a thesis made before it existed (no `setup` key, no card).
 */

import { z } from 'zod';
import { sourcePrefsSchema } from './source-prefs.js';

/**
 * Every step a card can be on, in order. `field` is kept for a card saved before ADR-0151 folded
 * the field and university into the title row; no card is moved onto it now.
 */
export const SETUP_STEPS = ['title', 'field', 'aim', 'chapters', 'first'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const setupCardSchema = z.object({
  /** The row that is open; every row before it is finished and folded. */
  step: z.enum(SETUP_STEPS),
  /** The first sentence is written: the card folds into the status line for good. */
  done: z.boolean(),
  /** "Finish later": folded into the status line until Show or First steps brings it back. */
  dismissedAt: z.string().nullable(),
  /** The aim row's one-line summary: the focus chosen, and how many objectives came of it. */
  aim: z
    .object({
      focus: z.string().max(200).nullable(),
      objectives: z.number().int().min(0).max(20),
      /** True when the student skipped the questions and the chapters were planned from the title. */
      fromTitle: z.boolean(),
    })
    .nullable(),
  /** How the chapters row was answered: the plan kept, the standard chapters, or one chapter. */
  chapters: z.enum(['planned', 'standard', 'none']).nullable(),
});
export type SetupCard = z.infer<typeof setupCardSchema>;

/** A new thesis's card, at its first row. */
export function newSetupCard(): SetupCard {
  return { step: 'title', done: false, dismissedAt: null, aim: null, chapters: null };
}

/** The card on a document's `meta`, or null for a thesis that never had one. */
export function readSetupCard(meta: unknown): SetupCard | null {
  if (!meta || typeof meta !== 'object') return null;
  const parsed = setupCardSchema.safeParse((meta as { setup?: unknown }).setup);
  return parsed.success ? parsed.data : null;
}

/** The rows the card shows (ADR-0151): the field and university are part of the title row. */
export const SETUP_ROWS = ['title', 'aim', 'chapters', 'first'] as const;
export type SetupRow = (typeof SETUP_ROWS)[number];
/** How many rows the card has: "n of 4". */
export const SETUP_ROW_COUNT = SETUP_ROWS.length;

/** The row a step shows: a card saved on the old field step shows the title row's next, the aim. */
export function setupRow(step: SetupStep): SetupRow {
  return step === 'field' ? 'aim' : step;
}

/** "2 of 4": the open row's place, counting from one. */
export function setupStepNumber(step: SetupStep): number {
  return SETUP_ROWS.indexOf(setupRow(step)) + 1;
}

/**
 * What `PUT /documents/:id/setup` takes. Every part is optional; the route does only what it is
 * given. `title` renames the thesis and, for a title that names a topic, starts the paper search
 * that creation starts today (ADR-0070); `field` and `universityId` are the field row's answers.
 */
export const setupUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  sourcePrefs: sourcePrefsSchema.optional(),
  field: z.string().trim().max(200).nullable().optional(),
  universityId: z.string().trim().max(80).nullable().optional(),
  step: z.enum(SETUP_STEPS).optional(),
  done: z.boolean().optional(),
  dismissed: z.boolean().optional(),
  aim: setupCardSchema.shape.aim.optional(),
  chapters: setupCardSchema.shape.chapters.optional(),
});
export type SetupUpdate = z.infer<typeof setupUpdateSchema>;

/** The card after an update: only the parts given change. */
export function applySetupUpdate(
  current: SetupCard | null,
  update: SetupUpdate,
  now: Date = new Date(),
): SetupCard {
  const card = current ?? newSetupCard();
  return {
    step: update.step ?? card.step,
    done: update.done ?? card.done,
    dismissedAt:
      update.dismissed === undefined
        ? card.dismissedAt
        : update.dismissed
          ? now.toISOString()
          : null,
    aim: update.aim === undefined ? card.aim : update.aim,
    chapters: update.chapters === undefined ? card.chapters : update.chapters,
  };
}

/** The placeholder a thesis made by New carries until the student names it. */
export const UNTITLED_THESIS = 'Untitled thesis';

/**
 * Whether a working title names something an index can search for, or a plan can be made from
 * (ADR-0070, ADR-0072): not a placeholder, and at least three words of three letters or more.
 * The API's `namesATopic` is this function.
 */
export function namesATopic(title: string): boolean {
  const t = title.trim();
  if (/^(untitled|new|my)\s+(thesis|dissertation|document)$/i.test(t)) return false;
  return t.split(/\s+/).filter((w) => w.length > 2).length >= 3;
}

/** How long an untouched "Untitled thesis" from New stays on the list (ADR-0145). */
export const UNTOUCHED_HIDE_MS = 24 * 60 * 60 * 1000;

/**
 * ADR-0145: a thesis New made and nobody touched — still "Untitled thesis", its card still on the
 * title row, no words in any chapter beyond each chapter's own heading, made over a day ago. The
 * list leaves it out; nothing is deleted, and naming it or writing in it brings it back.
 */
export function isUntouchedNewThesis(
  row: {
    title: string;
    createdAt: Date;
    meta: unknown;
    chapters: ReadonlyArray<{ title: string; wordCount: number }>;
  },
  now: Date = new Date(),
): boolean {
  if (row.title !== UNTITLED_THESIS) return false;
  if (now.getTime() - row.createdAt.getTime() < UNTOUCHED_HIDE_MS) return false;
  const card = readSetupCard(row.meta);
  if (!card || card.done || card.step !== 'title') return false;
  const headingWords = (title: string) => title.trim().split(/\s+/).filter(Boolean).length;
  return row.chapters.every((c) => c.wordCount <= headingWords(c.title));
}
