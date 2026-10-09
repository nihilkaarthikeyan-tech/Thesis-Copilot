/**
 * Highlights and notes on a paper in the reader (ADR-0130). Shared by the API, which checks every
 * body against these, and the reader, which keeps within them before it asks.
 *
 * The colours are the editor's own highlight colours (`HIGHLIGHT_COLORS`), so a yellow in a paper
 * and a yellow in the thesis are the same yellow.
 */

import { z } from 'zod';
import { HIGHLIGHT_COLORS } from './text-colors.js';

/** A passage longer than this is not a highlight; it is most of a page. */
export const READER_HIGHLIGHT_QUOTE_MAX = 4_000;
/** A short note, as the plan asks — a margin note, not a second document. */
export const READER_NOTE_MAX = 2_000;
/** The words kept either side of a highlight, to find it again when its offsets no longer fit. */
export const READER_CONTEXT_CHARS = 32;
/** More than any student marks on one paper; a bound so a runaway script cannot fill the table. */
export const READER_HIGHLIGHTS_PER_SOURCE_MAX = 500;

export const readerHighlightColour = z.enum(HIGHLIGHT_COLORS);
export type ReaderHighlightColour = z.infer<typeof readerHighlightColour>;

export const readerHighlightCreate = z
  .object({
    view: z.enum(['PDF', 'TEXT']),
    page: z.number().int().min(1).max(100_000).nullable(),
    chunkId: z.string().uuid().nullable(),
    start: z.number().int().min(0).max(10_000_000),
    end: z.number().int().min(1).max(10_000_000),
    exact: z.string().min(1).max(READER_HIGHLIGHT_QUOTE_MAX),
    prefix: z.string().max(READER_CONTEXT_CHARS * 2),
    suffix: z.string().max(READER_CONTEXT_CHARS * 2),
    quote: z.string().trim().min(1).max(READER_HIGHLIGHT_QUOTE_MAX),
    colour: readerHighlightColour,
    note: z.string().max(READER_NOTE_MAX).nullable().optional(),
  })
  .refine((h) => h.end > h.start, { message: 'A highlight ends after it starts.', path: ['end'] });
export type ReaderHighlightCreate = z.infer<typeof readerHighlightCreate>;

export const readerHighlightUpdate = z
  .object({
    colour: readerHighlightColour.optional(),
    note: z.string().max(READER_NOTE_MAX).nullable().optional(),
  })
  .refine((u) => u.colour !== undefined || u.note !== undefined, {
    message: 'Change the colour or the note.',
  });
export type ReaderHighlightUpdate = z.infer<typeof readerHighlightUpdate>;

/** One highlight as the API returns it. */
export type ReaderHighlight = {
  id: string;
  sourceId: string;
  view: 'PDF' | 'TEXT';
  page: number | null;
  chunkId: string | null;
  start: number;
  end: number;
  exact: string;
  prefix: string;
  suffix: string;
  quote: string;
  colour: ReaderHighlightColour;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};
