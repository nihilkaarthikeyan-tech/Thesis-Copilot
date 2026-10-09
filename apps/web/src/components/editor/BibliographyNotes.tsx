'use client';

/**
 * Bibliography notes — Jenni build plan R25 (ADR-0112; inventory §13.3).
 *
 * Jenni's Source Quality review ends with a publication-year chart and a venue spread. These are
 * the same two notes over the papers the open chapter cites, inside the Source quality panel.
 * Plain HTML bars, no chart library: the side panel is 288 px wide, so the chart is as wide as the
 * panel at most and narrower when there are only a few bars, never wider than its box. Every
 * figure is from the API; a paper with no year or venue on record is said to have none.
 */

import {
  type BibliographyNotes,
  binIsOld,
  binLabel,
  citedHeading,
  venueSentence,
  worksPhrase as works,
  yearSentence,
} from '@/lib/bibliography-notes';

/** A bar's slot is at most this wide, so three bars do not stretch across the whole panel. */
const SLOT_PX = 40;

export function BibliographyNotesView({ notes }: { notes: BibliographyNotes }) {
  if (notes.works === 0) {
    return (
      <p className="mt-3 text-xs text-muted" data-testid="bibliography-notes-empty">
        This chapter cites no papers yet, so there are no year or venue notes. Cite from your
        library and check again.
      </p>
    );
  }
  const { years, venues } = notes;
  const tallest = Math.max(1, ...years.bins.map((b) => b.works));
  const widest = Math.max(1, ...venues.top.map((v) => v.works));
  const anyOld = years.bins.some((b) => b.works > 0 && binIsOld(b, notes));
  const first = years.bins[0];
  const last = years.bins[years.bins.length - 1];

  return (
    <div className="mt-3 grid min-w-0 grid-cols-1 gap-3" data-testid="bibliography-notes">
      <p className="text-[11px] font-semibold text-ink">{citedHeading(notes.works)}</p>

      <figure className="m-0 min-w-0" data-testid="bibliography-years">
        <figcaption className="text-xs text-muted">
          <span className="font-semibold text-ink">Publication years.</span> {yearSentence(notes)}
        </figcaption>
        {years.bins.length > 0 && first && last ? (
          <div className="mt-1.5 w-full" style={{ maxWidth: years.bins.length * SLOT_PX }}>
            <div
              className="flex h-12 items-end gap-[2px] border-b border-line-strong"
              role="img"
              aria-label={years.bins.map((b) => `${binLabel(b)}: ${works(b.works)}`).join('; ')}
            >
              {years.bins.map((bin) => (
                <div
                  key={bin.from}
                  title={`${binLabel(bin)}: ${works(bin.works)}`}
                  className="flex h-full min-w-0 flex-1 items-end"
                >
                  {bin.works > 0 ? (
                    <div
                      className={`w-full rounded-t-sm ${binIsOld(bin, notes) ? 'bg-faint' : 'bg-accent'}`}
                      style={{ height: `${Math.max(6, Math.round((bin.works / tallest) * 100))}%` }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
            <div className="tnum mt-0.5 flex justify-between gap-2 text-[10px] text-faint">
              <span>{first.from}</span>
              {years.bins.length > 1 ? <span>{last.to}</span> : null}
            </div>
          </div>
        ) : null}
        {anyOld ? (
          <p className="mt-0.5 text-[10px] text-faint">Grey bars: over a decade old.</p>
        ) : null}
      </figure>

      <figure className="m-0 min-w-0" data-testid="bibliography-venues">
        <figcaption className="text-xs text-muted">
          <span className="font-semibold text-ink">Venues.</span> {venueSentence(notes)}
        </figcaption>
        {venues.top.length > 0 ? (
          <ul className="mt-1.5 grid list-none grid-cols-1 gap-1.5 p-0">
            {venues.top.map((venue) => (
              <li key={venue.name} className="min-w-0 text-xs">
                <span className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-ink" title={venue.name}>
                    {venue.name}
                  </span>
                  <span className="tnum shrink-0 text-muted">{venue.works}</span>
                </span>
                <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-line">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${Math.round((venue.works / widest) * 100)}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {venues.otherWorks > 0 ? (
          <p className="mt-1 text-[11px] text-muted">
            And {works(venues.otherWorks)} in{' '}
            {venues.unique - venues.top.length === 1
              ? 'one other venue'
              : `${venues.unique - venues.top.length} other venues`}
            .
          </p>
        ) : null}
      </figure>
    </div>
  );
}
