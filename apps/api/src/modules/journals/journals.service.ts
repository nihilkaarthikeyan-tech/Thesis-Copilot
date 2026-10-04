/**
 * Journal matching — ADR-0040. Builds a grounded match profile from the thesis (its field, its key
 * terms, and the journals its own cited sources were published in), gathers candidate journals from
 * OpenAlex, and ranks them with the deterministic scorer in `@tc/retrieval`. No LLM, no metered
 * unit: the ranking is pure code and the only cost is one or two OpenAlex calls on the polite pool.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Env } from '@tc/config';
import { type JournalScore, OpenAlexSources, rankJournals, tokensOf } from '@tc/retrieval';
import { ENV } from '../../common/env.token.js';
import { NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';

export type JournalsView = {
  /** The key terms and field the match was run on, so the student sees what it used. */
  basis: {
    keywords: string[];
    field: string | null;
    /** Journals the library's sources were published in. */
    libraryVenueCount: number;
    /** Of those, the journals of sources the thesis cites in its text. */
    citedVenueCount: number;
  };
  eligible: JournalScore[];
  ruledOut: JournalScore[];
  /** True when the library had no resolved venue and nothing to search: the student should add sources. */
  thin: boolean;
};

@Injectable()
export class JournalsService {
  private readonly logger = new Logger(JournalsService.name);
  private readonly sources: OpenAlexSources;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) env: Env,
  ) {
    this.sources = new OpenAlexSources({
      mailto: env.OPENALEX_MAILTO,
      ...(env.OPENALEX_API_KEY ? { apiKey: env.OPENALEX_API_KEY } : {}),
    });
  }

  async match(
    ownerId: string,
    documentId: string,
    preferOpenAccess = false,
    maxApcUsd: number | null = null,
  ): Promise<JournalsView> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: {
        id: true,
        title: true,
        field: true,
        memory: { select: { scope: true, glossary: true, outline: true } },
      },
    });
    if (!document) throw new NotFoundError('That document');

    // The venues the thesis's library sources were published in — the grounded fit signal. The
    // whole library counts, cited in the text or not; `citedVenueCount` says how many of those
    // venues carry a source the thesis actually cites, so the screen does not say "you cite"
    // of a library nobody has cited from yet.
    const library = await this.prisma.source.findMany({
      where: { documentId, status: 'RESOLVED', venueOpenalexId: { not: null } },
      select: { venueOpenalexId: true, _count: { select: { citations: true } } },
    });
    const citedVenues: Record<string, number> = {};
    const venuesCitedInText = new Set<string>();
    for (const s of library) {
      if (!s.venueOpenalexId) continue;
      citedVenues[s.venueOpenalexId] = (citedVenues[s.venueOpenalexId] ?? 0) + 1;
      if (s._count.citations > 0) venuesCitedInText.add(s.venueOpenalexId);
    }

    const keywords = this.keywordsFor(document);
    const query = [document.title, document.field, ...keywords.slice(0, 6)]
      .filter(Boolean)
      .join(' ');

    const candidates = await this.sources
      .gather({ citedVenueIds: Object.keys(citedVenues), query })
      .catch((error: unknown) => {
        this.logger.warn({ documentId, error: String(error) }, 'OpenAlex sources gather failed');
        return [];
      });

    const ranked = rankJournals(candidates, {
      keywords,
      field: document.field,
      citedVenues,
      preferOpenAccess,
      maxApcUsd,
    });

    return {
      basis: {
        keywords,
        field: document.field,
        libraryVenueCount: Object.keys(citedVenues).length,
        citedVenueCount: venuesCitedInText.size,
      },
      eligible: ranked.filter((r) => r.eligible),
      ruledOut: ranked.filter((r) => !r.eligible),
      thin: candidates.length === 0,
    };
  }

  /** Key terms: the glossary terms, the objectives' content words, and the title — deduped. */
  private keywordsFor(document: {
    title: string;
    field: string | null;
    memory: { scope: unknown; glossary: unknown; outline: unknown } | null;
  }): string[] {
    const out = new Set<string>();
    const glossary = (document.memory?.glossary as Record<string, unknown> | null) ?? {};
    for (const term of Object.keys(glossary)) out.add(term.trim());
    const scope = (document.memory?.scope as { objectives?: unknown[] } | null) ?? {};
    for (const objective of scope.objectives ?? []) {
      // The notable noun phrases of an objective: capitalised terms and technical tokens.
      for (const phrase of String(objective).split(/[,.;:]/)) {
        const t = phrase.trim();
        if (t.length >= 4 && tokensOf(t).length > 0 && tokensOf(t).length <= 5) out.add(t);
      }
    }
    out.add(document.title);
    // Keep the set small and specific.
    return [...out].filter((k) => k.length >= 3).slice(0, 20);
  }
}
