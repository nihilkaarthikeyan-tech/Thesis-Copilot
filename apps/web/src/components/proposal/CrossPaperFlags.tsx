'use client';

/**
 * Cross-paper flags — PRD FR-1.6, PHASES 6.2.
 *
 *   "flags render as a list; each links to the two passages."
 *
 * The passages are the papers' own findings; each flag names its papers and links to their
 * extraction. Nothing here is a verdict — the student reads both and decides.
 */

export type CrossPaper = {
  overlaps: Array<{ claim: string; papers: string[] }>;
  contradictions: Array<{
    topic: string;
    a: { paper: string; claim: string };
    b: { paper: string; claim: string };
    explanation: string;
  }>;
  terminology: Array<{ term: string; definitions: Array<{ paper: string; definition: string }> }>;
  papers: Array<{ id: string; seedPaperId: string; title: string }>;
  at: string;
};

export function CrossPaperFlags({ documentId, flags }: { documentId: string; flags: CrossPaper }) {
  const paper = (id: string) => flags.papers.find((p) => p.id === id);
  const link = (id: string) => {
    const p = paper(id);
    return p ? (
      <a
        key={id}
        href={`/app/d/${documentId}/sources#paper-${p.seedPaperId}`}
        className="underline"
        title={p.title}
      >
        {p.title.length > 40 ? `${p.title.slice(0, 39)}…` : p.title}
      </a>
    ) : (
      <span key={id}>{id}</span>
    );
  };
  const total = flags.overlaps.length + flags.contradictions.length + flags.terminology.length;

  return (
    <section className="mt-8" data-testid="cross-paper">
      <h2 className="font-serif text-lg">Across your papers</h2>
      <p className="mt-1 text-sm text-muted">
        {flags.papers.length} papers compared. {total === 0 ? 'Nothing to flag.' : ''}
      </p>

      {flags.overlaps.length > 0 ? (
        <div className="mt-3">
          <h3 className="text-sm font-medium">Said in more than one paper</h3>
          <ul className="mt-1 space-y-2 text-sm" data-testid="overlaps">
            {flags.overlaps.map((o) => (
              <li key={o.claim} className="rounded-md border border-line bg-surface px-3 py-2">
                <p>{o.claim}</p>
                <p className="mt-1 text-xs text-muted">
                  In {o.papers.map((id, i) => [i > 0 ? ' and ' : '', link(id)])} — say it once in
                  the thesis.
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {flags.contradictions.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-sm font-medium">Cannot both be true</h3>
          <ul className="mt-1 space-y-2 text-sm" data-testid="contradictions">
            {flags.contradictions.map((c) => (
              <li key={c.topic} className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2">
                <p className="font-medium">{c.topic}</p>
                <p className="mt-1">
                  {link(c.a.paper)}: “{c.a.claim}”
                </p>
                <p>
                  {link(c.b.paper)}: “{c.b.claim}”
                </p>
                <p className="mt-1 text-xs text-muted">{c.explanation}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {flags.terminology.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-sm font-medium">Defined differently</h3>
          <ul className="mt-1 space-y-2 text-sm" data-testid="terminology">
            {flags.terminology.map((t) => (
              <li key={t.term} className="rounded-md border border-line bg-surface px-3 py-2">
                <p className="font-medium">{t.term}</p>
                {t.definitions.map((d) => (
                  <p key={`${d.paper}-${d.definition}`} className="text-xs text-muted">
                    {link(d.paper)}: {d.definition}
                  </p>
                ))}
                <p className="mt-1 text-xs text-muted">
                  Both are kept in the glossary, flagged, until you pick one.
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
