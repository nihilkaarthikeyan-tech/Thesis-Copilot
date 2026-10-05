/**
 * The claims map — ADR-0086 (row 63 of the Jenni coverage map, 2026-10-05).
 *
 * The living gap map (ADR-0041/0046) reasons over counts: how many candidates a theme has, how
 * dense the field is. Jenni's gap analysis reasons over claims: what the literature says, how
 * well each claim is supported, where papers disagree, and what a thesis could do about it. This
 * is that: one strong-tier pass over the library's papers (title, year, abstract or first
 * passage), up to fifteen claims with supporting and contrasting papers, a direction and a
 * limit each. Grounding: a paper id not in the request is stripped; a claim with no supporting
 * paper is dropped.
 *
 * Logged as `CROSS_PAPER` (A.16's family, one pass over several papers), bounded to once per
 * document per hour by the API; not a per-unit allowance.
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';
import { renderScope, type ScopeForQueries } from './queries.js';

export const CLAIMS_MAP = {
  tier: 'strong',
  maxTokens: 2_500,
  temperature: 0.2,
  /** Papers sent, at most: enough for a library, bounded for the prompt. */
  maxPapers: 30,
  /** Characters of each paper's abstract or first passage. */
  paperChars: 900,
  maxClaims: 15,
  /** How often a library may be mapped again (the API's cooldown). */
  cooldownSeconds: 60 * 60,
} as const;

export const MAPPED_CLAIM_STATUSES = ['well-supported', 'contested', 'under-explored'] as const;
export type MappedClaimStatus = (typeof MAPPED_CLAIM_STATUSES)[number];

/** `status` is a plain string: an unknown label is set from the evidence (the ADR-0026 lesson). */
export const claimsMapSchema = z.object({
  claims: z.array(
    z.object({
      claim: z.string(),
      status: z.string(),
      supporting: z.array(z.string()),
      contrasting: z.array(z.string()),
      direction: z.string(),
      limits: z.string(),
    }),
  ),
});
export type ClaimsMapResult = z.infer<typeof claimsMapSchema>;

export type ClaimsMapPaper = {
  id: string;
  title: string;
  year: number | null;
  /** The abstract, or the first passage when there is none. */
  text: string;
};

export type MappedClaim = {
  claim: string;
  status: MappedClaimStatus;
  supporting: string[];
  contrasting: string[];
  direction: string;
  limits: string;
};

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export function claimsMapUserMessage(input: {
  scope: ScopeForQueries;
  papers: readonly ClaimsMapPaper[];
}): string {
  const papers = input.papers
    .slice(0, CLAIMS_MAP.maxPapers)
    .map(
      (p) =>
        `<paper id="${escapeAttr(p.id)}"${p.year ? ` year="${p.year}"` : ''}>${norm(p.title)} — ${norm(p.text).slice(0, CLAIMS_MAP.paperChars)}</paper>`,
    )
    .join('\n');
  return `${renderScope(input.scope)}\n<papers>\n${papers}\n</papers>`;
}

export function buildClaimsMapRequest(input: {
  scope: ScopeForQueries;
  papers: readonly ClaimsMapPaper[];
  userId: string;
  documentId: string;
  signal?: AbortSignal;
}): Omit<LlmRequest, 'schema'> {
  return {
    tier: CLAIMS_MAP.tier,
    system: { cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('claims').system}` },
    messages: [{ role: 'user', content: claimsMapUserMessage(input) }],
    maxTokens: CLAIMS_MAP.maxTokens,
    temperature: CLAIMS_MAP.temperature,
    action: 'CROSS_PAPER',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

/** The status the evidence counts give, when the model's label is not one of the three. */
export function statusFromEvidence(supporting: number, contrasting: number): MappedClaimStatus {
  if (contrasting > 0) return 'contested';
  return supporting >= 3 ? 'well-supported' : 'under-explored';
}

/**
 * The rules in code: only ids that were sent; at least one supporting paper; a known status (or
 * one from the evidence); each claim once; at most `maxClaims`, in the model's order.
 */
export function postProcessClaimsMap(
  result: ClaimsMapResult,
  paperIds: readonly string[],
): { claims: MappedClaim[]; stripped: number } {
  const known = new Set(paperIds);
  const seen = new Set<string>();
  const claims: MappedClaim[] = [];
  let stripped = 0;
  for (const item of result.claims) {
    const claim = norm(item.claim);
    const key = claim.toLowerCase();
    if (!claim || seen.has(key)) continue;
    const keep = (ids: readonly string[]) => {
      const kept = [...new Set(ids.map((id) => id.trim()).filter((id) => known.has(id)))];
      stripped += ids.length - kept.length;
      return kept;
    };
    const supporting = keep(item.supporting);
    const contrasting = keep(item.contrasting).filter((id) => !supporting.includes(id));
    if (supporting.length === 0) continue;
    const label = norm(item.status).toLowerCase();
    const status = (MAPPED_CLAIM_STATUSES as readonly string[]).includes(label)
      ? (label as MappedClaimStatus)
      : statusFromEvidence(supporting.length, contrasting.length);
    seen.add(key);
    claims.push({
      claim,
      status,
      supporting,
      contrasting,
      direction: norm(item.direction).slice(0, 240),
      limits: norm(item.limits).slice(0, 240),
    });
    if (claims.length === CLAIMS_MAP.maxClaims) break;
  }
  return { claims, stripped };
}

/**
 * The mock: one claim per paper from its own title, the first well-supported by the first three,
 * the second contested by the third, the rest under-explored — the three statuses on screen,
 * every id from the request.
 */
export const mockClaimsMapResponse = {
  match: (req: { action: string; messages: ReadonlyArray<{ content: string }> }) =>
    req.action === 'CROSS_PAPER' && (req.messages.at(-1)?.content ?? '').includes('<papers>'),
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): ClaimsMapResult => {
    const content = req.messages.at(-1)?.content ?? '';
    const papers = [...content.matchAll(/<paper id="([^"]+)"[^>]*>([^—<]+)/g)].map((m) => ({
      id: m[1] ?? '',
      title: (m[2] ?? '').trim(),
    }));
    const ids = papers.map((p) => p.id);
    return {
      claims: papers.slice(0, CLAIMS_MAP.maxClaims).map((p, i) => ({
        claim: `${p.title.slice(0, 80)} holds in the settings studied`,
        status: i === 0 ? 'well-supported' : i === 1 ? 'contested' : 'under-explored',
        supporting: i === 0 ? ids.slice(0, 3) : [p.id],
        contrasting: i === 1 && ids.length > 2 ? [ids[2] as string] : [],
        direction: 'Test it in this thesis’s own setting.',
        limits: 'The papers cover other settings and years than this thesis.',
      })),
    };
  },
};
