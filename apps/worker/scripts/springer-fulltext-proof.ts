/**
 * Live proof of the Springer Nature full-text step (ADR-0134): fetches real open-access papers
 * through `SpringerNatureClient` with the real key, chunks them exactly as `index-source` does, and
 * prints each paper's sections with their character counts. Writes nothing; no model is called.
 * Each paper costs one of the free plan's 500 requests a day.
 *
 * Run: `pnpm --filter @tc/worker exec dotenv -e ../../.env -- tsx scripts/springer-fulltext-proof.ts [doi …]`
 *
 * The key is read from `SPRINGER_NATURE_API_KEY` and never printed.
 */

import { chunkText, isSpringerNatureDoi, SpringerNatureClient } from '@tc/retrieval';

const DEFAULT_DOIS = [
  // Discover Food (Springer, gold OA; not in PMC) — the journal of the ADR-0054 comparison.
  '10.1007/s44187-024-00103-w',
  // Nature Communications.
  '10.1038/s41467-022-33407-5',
  // The European Physical Journal C (SpringerOpen / SCOAP3).
  '10.1140/epjc/s10052-024-12995-0',
];

async function main(): Promise<void> {
  const key = process.env.SPRINGER_NATURE_API_KEY?.trim();
  if (!key) {
    console.error('SPRINGER_NATURE_API_KEY is not set; nothing to prove.');
    process.exitCode = 1;
    return;
  }
  const client = new SpringerNatureClient(key);
  const dois = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_DOIS;

  for (const doi of dois) {
    const started = Date.now();
    const out = await client.fullText(doi, AbortSignal.timeout(60_000));
    const ms = Date.now() - started;
    console.log(`\n${doi}  (Springer Nature DOI: ${isSpringerNatureDoi(doi) ? 'yes' : 'no'})`);
    if (!out.ok) {
      console.log(
        `  no full text: ${out.reason}${out.status ? ` (HTTP ${out.status})` : ''}, ${ms} ms`,
      );
      continue;
    }
    const chunks = chunkText({ text: out.text, sections: out.sections });
    console.log(
      `  FULL_TEXT: ${out.text.length.toLocaleString('en')} characters, ${out.sections.length} sections, ` +
        `${chunks.length} chunks, ${ms} ms, licence ${out.license ?? 'unstated'}`,
    );
    for (const span of out.sections) {
      const inSection = chunks.filter((c) => c.section === span.section).length;
      console.log(
        `    ${String(span.end - span.start).padStart(7)} chars  ${String(inSection).padStart(3)} chunks  ${span.section}`,
      );
    }
    // A table, to show it kept its rows: its caption line and the header row under it.
    const table = /(Table \d+\.[^\n]{0,90})[^\n]*\n([^\n]{0,110})/.exec(out.text);
    if (table) console.log(`  e.g. ${table[1]}\n       ${table[2]}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
