/**
 * `pnpm backfill:journals` — ADR-0022, run once after deploying it.
 *
 * Sources resolved before the journal figure existed have neither the journal nor its figure.
 * This finds each resolved source with a DOI and no journal, asks OpenAlex which journal it
 * appeared in, then asks for all those journals' 2-year mean citedness in batches of fifty. A
 * source OpenAlex does not know, or a journal it has no figure for, is left unknown: nothing here
 * writes a number that was not read.
 *
 * Safe to run again: it only touches sources whose journal is still unset.
 */

import { PrismaClient } from '@tc/db';
import { OpenAlexClient, openalexSourceId } from '@tc/retrieval';

const mailto = process.env.OPENALEX_MAILTO;
if (!mailto) throw new Error('OPENALEX_MAILTO is not set');

const prisma = new PrismaClient();
const openalex = new OpenAlexClient({ mailto });

async function main(): Promise<void> {
  const sources = await prisma.source.findMany({
    where: { status: 'RESOLVED', doi: { not: null }, venueOpenalexId: null },
    select: { id: true, doi: true },
  });
  console.log(`${sources.length} resolved sources with a DOI and no journal yet`);

  const venueOf = new Map<string, string>();
  let unknown = 0;
  for (const source of sources) {
    try {
      const work = await openalex.byDoi(source.doi as string);
      const venue = openalexSourceId(
        (work as { primary_location?: { source?: { id?: string } } } | null)?.primary_location
          ?.source?.id,
      );
      if (venue) venueOf.set(source.id, venue);
      else unknown += 1;
    } catch (error) {
      unknown += 1;
      console.warn(`  ${source.doi}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const figures = await openalex.journalCitedness([...new Set(venueOf.values())]);
  let scored = 0;
  for (const [sourceId, venue] of venueOf) {
    const value = figures.get(venue) ?? null;
    if (value !== null) scored += 1;
    await prisma.source.update({
      where: { id: sourceId },
      data: { venueOpenalexId: venue, venueCitedness: value },
    });
  }

  console.log(
    `${venueOf.size} matched to a journal (${scored} with a figure), ${unknown} not known to OpenAlex`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
