/**
 * Sub-theme labelling — PRD FR-2.6, Appendix A.8, PHASES v2 W7.2.
 *
 * One Fast, temperature-0 structured call groups the kept candidates into at most eight themes.
 * Rules the prompt states are re-checked in code: every candidate lands in exactly one theme
 * (anything the model dropped goes to "Other"), and a theme with fewer than four candidates is
 * "thin" (FR-2.6).
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';
import { renderScope, type ScopeForQueries } from './queries.js';

export const THEMES = {
  tier: 'fast',
  maxTokens: 1_500,
  temperature: 0,
  maxThemes: 8,
  /** FR-2.6: "themes with < 4 sources marked thin". */
  thinBelow: 4,
  /** A.8: "first 40 words of abstract". */
  abstractWords: 40,
} as const;

export const themesSchema = z.object({
  themes: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        candidateIds: z.array(z.string()),
      }),
    )
    .max(12),
});
export type ThemesResult = z.infer<typeof themesSchema>;

export type ThemeCandidate = { id: string; title: string; abstract: string | null };

export type ThemesInput = {
  scope: ScopeForQueries;
  candidates: readonly ThemeCandidate[];
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

const firstWords = (text: string | null, n: number) =>
  (text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, n).join(' ');

/** A.8: "<candidates> with `- id | title | first 40 words of abstract`, plus the <scope> block". */
export function themesUserMessage(input: ThemesInput): string {
  const lines = input.candidates.map(
    (c) =>
      `- ${c.id} | ${c.title.replace(/\|/g, '/')} | ${firstWords(c.abstract, THEMES.abstractWords)}`,
  );
  return `<candidates>\n${lines.join('\n')}\n</candidates>\n\n${renderScope(input.scope)}`;
}

export function buildThemesRequest(input: ThemesInput): Omit<LlmRequest, 'schema'> {
  return {
    tier: THEMES.tier,
    system: { cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('themes').system}` },
    messages: [{ role: 'user', content: themesUserMessage(input) }],
    maxTokens: THEMES.maxTokens,
    temperature: THEMES.temperature,
    action: 'SEARCH_QUERIES',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

export type GapTheme = { name: string; candidateIds: string[]; count: number; thin: boolean };

/**
 * A.8's rules enforced after the fact: unknown ids dropped, duplicates kept in their first theme,
 * candidates the model forgot collected under "Other", at most eight themes (the smallest merge
 * into "Other"), and the thin flag computed.
 */
export function normaliseThemes(result: ThemesResult, candidateIds: readonly string[]): GapTheme[] {
  const known = new Set(candidateIds);
  const placed = new Set<string>();
  let themes = result.themes
    .map((t) => ({
      name: t.name.trim(),
      candidateIds: t.candidateIds.filter((id) => {
        if (!known.has(id) || placed.has(id)) return false;
        placed.add(id);
        return true;
      }),
    }))
    .filter((t) => t.candidateIds.length > 0);

  const missing = candidateIds.filter((id) => !placed.has(id));
  if (missing.length > 0) {
    const other = themes.find((t) => t.name.toLowerCase() === 'other');
    if (other) other.candidateIds.push(...missing);
    else themes.push({ name: 'Other', candidateIds: [...missing] });
  }

  if (themes.length > THEMES.maxThemes) {
    themes.sort((a, b) => b.candidateIds.length - a.candidateIds.length);
    const keep = themes.slice(0, THEMES.maxThemes - 1);
    const rest = themes.slice(THEMES.maxThemes - 1).flatMap((t) => t.candidateIds);
    const other = keep.find((t) => t.name.toLowerCase() === 'other');
    if (other) other.candidateIds.push(...rest);
    else keep.push({ name: 'Other', candidateIds: rest });
    themes = keep;
  }

  return themes.map((t) => ({
    ...t,
    count: t.candidateIds.length,
    thin: t.candidateIds.length < THEMES.thinBelow,
  }));
}

// ---------------------------------------------------------------------------------------------
// Mock (AI_PROVIDER=mock)
// ---------------------------------------------------------------------------------------------

const STOP = new Set(
  'a an the of in on for to and or with by from at as is are be this that these those into among between across using toward towards what how why study analysis case based'.split(
    ' ',
  ),
);

/**
 * Groups candidates by the most frequent meaningful title word — a label taken from the papers'
 * own titles, never invented. Coarse, but every id lands in exactly one theme.
 */
export const mockThemesResponse = {
  match: (req: { action: string; messages: ReadonlyArray<{ content: string }> }) =>
    req.action === 'SEARCH_QUERIES' &&
    (req.messages.at(-1)?.content ?? '').includes('<candidates>'),
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): ThemesResult => {
    const text = req.messages.at(-1)?.content ?? '';
    const rows = [...text.matchAll(/^- ([^|]+) \| ([^|]*) \|/gm)].map((m) => ({
      id: (m[1] ?? '').trim(),
      title: (m[2] ?? '').trim(),
    }));
    const freq = new Map<string, number>();
    const wordsOf = (title: string) =>
      title
        .toLowerCase()
        .split(/[^a-z0-9-]+/)
        .filter((w) => w.length > 3 && !STOP.has(w));
    for (const row of rows)
      for (const w of new Set(wordsOf(row.title))) freq.set(w, (freq.get(w) ?? 0) + 1);
    const groups = new Map<string, string[]>();
    for (const row of rows) {
      const best = wordsOf(row.title).sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0))[0];
      const key = best ? best[0]?.toUpperCase() + best.slice(1) : 'Other';
      groups.set(key, [...(groups.get(key) ?? []), row.id]);
    }
    const themes = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, candidateIds]) => ({ name, candidateIds }));
    return { themes };
  },
};
