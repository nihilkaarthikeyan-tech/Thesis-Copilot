#!/usr/bin/env node
/**
 * Migrations-match-schema check — PRD §13.5 step 1 ("prisma migrate diff check").
 *
 * Applies nothing. Compares the database reached by DATABASE_URL (which CI has just migrated) with
 * `schema.prisma` and fails on any drift EXCEPT the two HNSW indexes on the `embedding` columns
 * (and, since 0036, one expression index; see ALLOWED).
 *
 * Why an allowlist: PRD §8 says "HNSW indexes are created in a hand-written migration" because
 * Prisma cannot declare an index on an `Unsupported("vector(1024)")` column. So `prisma migrate
 * diff` always reports those two indexes as "removed" relative to the schema. Everything else in
 * the diff is real drift and fails the build.
 *
 *   DATABASE_URL=postgresql://... node packages/db/scripts/migrate-diff-check.mjs
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dbPackage = join(here, '..');
const prismaCli = join(dbPackage, 'node_modules', 'prisma', 'build', 'index.js');
const schema = join(dbPackage, 'prisma', 'schema.prisma');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  [prismaCli, 'migrate', 'diff', '--from-url', url, '--to-schema-datamodel', schema, '--script'],
  { encoding: 'utf8', env: { ...process.env } },
);

if (result.status !== 0) {
  console.error(result.stdout);
  console.error(result.stderr);
  console.error('prisma migrate diff failed to run');
  process.exit(result.status ?? 1);
}

/**
 * `--script` prints SQL that would bring the DB to the schema. The only statements the allowlist
 * permits are DROP INDEX for the two HNSW indexes.
 */
const ALLOWED = [
  /^DROP INDEX "(public"\.")?source_chunk_embedding_hnsw";?$/,
  /^DROP INDEX "(public"\.")?chapter_chunk_embedding_hnsw";?$/,
  // 0036: one collection name per thesis whatever its case — an index on `lower("name")`, which
  // the Prisma schema cannot express either.
  /^DROP INDEX "(public"\.")?SourceCollection_documentId_lower_name_key";?$/,
];

const statements = result.stdout
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('--'));

const drift = statements.filter((s) => !ALLOWED.some((re) => re.test(s)));
const allowed = statements.filter((s) => ALLOWED.some((re) => re.test(s)));

console.log(
  `migrate-diff-check: ${allowed.length} allowlisted statement(s) (HNSW indexes, PRD §8)`,
);
for (const s of allowed) console.log(`  ok   ${s}`);

if (drift.length > 0) {
  console.error(
    '\nSCHEMA DRIFT: the migrations do not produce schema.prisma. Unexpected statements:',
  );
  for (const s of drift) console.error(`  !!   ${s}`);
  console.error(
    '\nWrite a migration for the change (pnpm --filter @tc/db migrate:dev) or fix the schema.',
  );
  process.exit(1);
}

console.log('migrate-diff-check: OK — migrations and schema.prisma agree');
