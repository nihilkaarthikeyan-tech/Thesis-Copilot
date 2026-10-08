/**
 * The claims map as a document — Jenni build plan R38, ADR-0123.
 *
 * Jenni's research gap analysis is a document the student can edit: a summary line, a table of
 * claims (Claim · Status · Evidence · Direction), then Under-explored, Contested, Well-supported,
 * Directions and Limits. Ours was a read-only panel (ADR-0086). This turns the map already stored
 * on `Document.meta.claims` into that document, as ProseMirror JSON, without a model call: every
 * word in it is either the map's own (the claim, the direction, the limit) or a plain sentence
 * written here from what the map recorded (how many papers were read, when, from what).
 *
 * Grounding: a citation is made only for a paper the map named for that claim **and** that is
 * still in this thesis's library, pointing at the passage the map read when it recorded one. A
 * claim left with no supporting paper is left out and counted, never shown uncited. Directions
 * and limits carry no citation: they are the mapping's suggestions about the thesis, not
 * something the papers say.
 *
 * Flag, don't fix: each section is a pending `draftBlock` with `DRAFT` provenance, accepted or
 * discarded by the student one by one, as a chapter build's sections are (ADR-0039).
 */

import type { MappedClaim, MappedClaimStatus } from '@tc/ai';

/** `Document.meta.claims` as `ClaimsService` stores it; `chunkId` since ADR-0123. */
export type StoredClaimsMap = {
  computedAt: string;
  papers: Array<{ id: string; title: string; year: number | null; chunkId?: string | null }>;
  claims: MappedClaim[];
};

/** The document's sections, in order; one pending draft block each. */
export const GAP_SECTIONS = [
  'claims',
  'under-explored',
  'contested',
  'well-supported',
  'directions',
  'limits',
] as const;
export type GapSection = (typeof GAP_SECTIONS)[number];

export const CLAIMS_DOCUMENT_TITLE = 'Research gap analysis';

const SECTION_TITLE: Record<GapSection, string> = {
  claims: 'Claims in the library',
  'under-explored': 'Under-explored',
  contested: 'Contested',
  'well-supported': 'Well supported',
  directions: 'Directions',
  limits: 'Limits of this mapping',
};

const STATUS_LABEL: Record<MappedClaimStatus, string> = {
  'under-explored': 'Under-explored',
  contested: 'Contested',
  'well-supported': 'Well supported',
};

/** Under-explored first, as the panel shows them: the gaps are what the student came for. */
const STATUS_ORDER: MappedClaimStatus[] = ['under-explored', 'contested', 'well-supported'];

type Json = Record<string, unknown>;

export type ClaimsDocumentInput = {
  map: StoredClaimsMap;
  /**
   * The map's papers still in this thesis's library, each with the passage to cite: the one the
   * map read, when it recorded it and the passage still exists; otherwise null (the paper itself).
   */
  available: ReadonlyMap<string, { chunkId: string | null }>;
  /** The `SuggestionEvent` id behind each section, for its provenance and its Accept. */
  actionIds: Readonly<Record<GapSection, string>>;
  newCitationKey: () => string;
  newRefId: () => string;
  /** Characters of each paper the map read (`CLAIMS_MAP.paperChars`), for the limits. */
  paperChars: number;
};

export type ClaimsDocument = {
  /** The pending draft blocks, one per section, in `GAP_SECTIONS` order. */
  blocks: Json[];
  /** Characters of text shown in each block, for its `SuggestionEvent`. */
  shownChars: Record<GapSection, number>;
  /** Claims in the document. */
  claims: number;
  /** Claims left out: none of the papers they rested on is in the library any more. */
  leftOut: number;
  /** Papers the kept claims named that are no longer in the library, so not cited. */
  missingPapers: number;
};

const day = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'an earlier date'
    : date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
};

const count = (n: number, one: string, many: string): string =>
  n === 1 ? `one ${one}` : `${n} ${many}`;

const Count = (n: number, one: string, many: string): string => {
  const s = count(n, one, many);
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
};

/** A claim short enough to name it in a list: at a word boundary, with an ellipsis. */
export function shortClaim(claim: string, max = 70): string {
  const text = claim.replace(/[.\s]+$/, '');
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, '')}…`;
}

/** The claim as a sentence body, its own full stop removed so the citations go before ours. */
const claimBody = (claim: string): string => claim.trim().replace(/\.+$/, '');

export function claimsDocument(input: ClaimsDocumentInput): ClaimsDocument {
  const { map, available } = input;
  const has = (id: string) => available.has(id);

  const kept: MappedClaim[] = [];
  const missing = new Set<string>();
  let leftOut = 0;
  for (const claim of map.claims) {
    const supporting = claim.supporting.filter(has);
    // A claim with none of its papers left is not shown at all: never a claim without a citation.
    if (supporting.length === 0) {
      leftOut++;
      continue;
    }
    for (const id of [...claim.supporting, ...claim.contrasting]) if (!has(id)) missing.add(id);
    kept.push({ ...claim, supporting, contrasting: claim.contrasting.filter(has) });
  }
  kept.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const byStatus = (status: MappedClaimStatus) => kept.filter((c) => c.status === status);

  const blocks: Json[] = [];
  const shownChars = {} as Record<GapSection, number>;

  for (const section of GAP_SECTIONS) {
    const actionId = input.actionIds[section];
    const provenance = { type: 'provenance', attrs: { kind: 'DRAFT', actionId } };
    let chars = 0;
    const text = (value: string, bold = false): Json => {
      chars += value.length;
      return {
        type: 'text',
        text: value,
        marks: bold ? [{ type: 'bold' }, provenance] : [provenance],
      };
    };
    const cites = (ids: readonly string[]): Json[] =>
      ids.map((sourceId) => ({
        type: 'citation',
        attrs: {
          key: input.newCitationKey(),
          sourceId,
          chunkId: available.get(sourceId)?.chunkId ?? null,
          role: 'parenthetical',
          locator: null,
          prefix: null,
          suffix: null,
        },
      }));
    const paragraph = (...inline: Json[]): Json => ({ type: 'paragraph', content: inline });
    const list = (items: Json[][]): Json => ({
      type: 'bulletList',
      content: items.map((inline) => ({ type: 'listItem', content: [paragraph(...inline)] })),
    });
    /** "The claim (A, 2020)(B, 2021)." — the claim, its papers, then the full stop. */
    const cited = (claim: string, ids: readonly string[], after = ''): Json[] => [
      text(`${claimBody(claim)} `),
      ...cites(ids),
      text(`.${after}`),
    ];

    const body: Json[] = [];
    switch (section) {
      case 'claims': {
        const statusLine = STATUS_ORDER.map((status) => {
          const n = byStatus(status).length;
          return `${n} ${STATUS_LABEL[status].toLowerCase()}`;
        }).join(', ');
        body.push(
          paragraph(
            text(
              `This mapping read ${count(map.papers.length, 'paper', 'papers')} in your library on ${day(map.computedAt)} and found ${count(kept.length, 'claim', 'claims')} that bear on your thesis: ${statusLine}. The claims are an AI’s summary of each paper’s abstract or opening passage, not quotations; check each against its papers before you rely on it.`,
            ),
          ),
        );
        const cell = (type: 'tableHeader' | 'tableCell', inline: Json[]): Json => ({
          type,
          content: [inline.length > 0 ? paragraph(...inline) : { type: 'paragraph' }],
        });
        const header = {
          type: 'tableRow',
          content: ['Claim', 'Status', 'Evidence', 'Direction'].map((h) =>
            cell('tableHeader', [text(h)]),
          ),
        };
        const rows = kept.map((c) => ({
          type: 'tableRow',
          content: [
            cell('tableCell', [text(claimBody(c.claim))]),
            cell('tableCell', [text(STATUS_LABEL[c.status])]),
            cell('tableCell', [
              text('Supporting: '),
              ...cites(c.supporting),
              text('.'),
              ...(c.contrasting.length > 0
                ? [text(' Contrasting: '), ...cites(c.contrasting), text('.')]
                : [text(' Contrasting: none found.')]),
            ]),
            cell('tableCell', c.direction ? [text(c.direction)] : []),
          ],
        }));
        body.push({
          type: 'table',
          attrs: {
            refId: input.newRefId(),
            caption: 'Claims in the library, with their evidence and a direction for this thesis',
          },
          content: [header, ...rows],
        });
        break;
      }
      case 'under-explored': {
        const claims = byStatus('under-explored');
        body.push(
          paragraph(
            text(
              claims.length > 0
                ? 'Claims that one or two papers in your library touch, or that the papers assume without testing: where your thesis could add evidence.'
                : 'The mapping marked no claim under-explored.',
            ),
          ),
        );
        for (const c of claims) {
          body.push(
            paragraph(
              ...cited(
                c.claim,
                c.supporting,
                ` Supported here by ${count(c.supporting.length, 'paper', 'papers')}.`,
              ),
            ),
          );
        }
        break;
      }
      case 'contested': {
        const claims = byStatus('contested');
        body.push(
          paragraph(
            text(
              claims.length > 0
                ? 'Claims that at least one paper in your library contradicts or qualifies.'
                : 'The mapping marked no claim contested.',
            ),
          ),
        );
        for (const c of claims) {
          body.push(
            paragraph(
              ...cited(c.claim, c.supporting),
              ...(c.contrasting.length > 0
                ? [text(' Contrasted by '), ...cites(c.contrasting), text('.')]
                : [text(' Marked contested, with no contrasting paper named.')]),
            ),
          );
        }
        break;
      }
      case 'well-supported': {
        const claims = byStatus('well-supported');
        body.push(
          paragraph(
            text(
              claims.length > 0
                ? 'Claims that three or more papers in your library agree on, with none contradicting.'
                : 'The mapping marked no claim well supported.',
            ),
          ),
        );
        for (const c of claims) body.push(paragraph(...cited(c.claim, c.supporting)));
        break;
      }
      case 'directions': {
        const withDirection = kept.filter((c) => c.direction);
        body.push(
          paragraph(
            text(
              withDirection.length > 0
                ? 'What your thesis could do with each claim, as the mapping suggests. These are suggestions for your work, not findings of the papers.'
                : 'The mapping suggested no directions.',
            ),
          ),
        );
        if (withDirection.length > 0) {
          body.push(
            list(
              withDirection.map((c) => [
                // The space after the bold lead-in is plain text: a bold run ending in a space let
                // that space hang past the line at a wrap (2026-10-08 layout check).
                text(`On “${shortClaim(c.claim)}”:`, true),
                text(` ${c.direction}`),
              ]),
            ),
          );
        }
        break;
      }
      case 'limits': {
        const facts = [
          `The claims were read from the abstract or opening passage of each paper, at most ${input.paperChars} characters of it, not from the full texts, in one AI reading on ${day(map.computedAt)}.`,
          `Only the ${count(map.papers.length, 'paper', 'papers')} in your library at that time were read; papers added since are not in it. Map the claims again on the Sources page to include them.`,
        ];
        if (leftOut > 0) {
          facts.push(
            `${Count(leftOut, 'claim is', 'claims are')} left out: the papers ${leftOut === 1 ? 'it' : 'they'} rested on are no longer in your library.`,
          );
        }
        if (missing.size > 0) {
          facts.push(
            `${Count(missing.size, 'paper the mapping named is', 'papers the mapping named are')} no longer in your library and not cited here.`,
          );
        }
        body.push(paragraph(text(facts.join(' '))));
        const withLimits = kept.filter((c) => c.limits);
        if (withLimits.length > 0) {
          body.push(paragraph(text('What the papers’ evidence cannot say, claim by claim:')));
          body.push(
            list(
              withLimits.map((c) => [
                text(`On “${shortClaim(c.claim)}”:`, true),
                text(` ${c.limits}`),
              ]),
            ),
          );
        }
        break;
      }
    }

    blocks.push({
      type: 'draftBlock',
      attrs: { draftId: actionId, status: 'pending' },
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [text(SECTION_TITLE[section])],
        },
        ...body,
      ],
    });
    shownChars[section] = chars;
  }

  return { blocks, shownChars, claims: kept.length, leftOut, missingPapers: missing.size };
}

/** The chapter: its title, the pending sections, and a paragraph after them to write in. */
export function claimsChapterDoc(title: string, blocks: readonly Json[]): Json {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
      ...blocks,
      { type: 'paragraph' },
    ],
  };
}
