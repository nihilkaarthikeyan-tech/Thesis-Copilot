/**
 * Database seed — PHASES.md PHASE-0 task 0.4.
 *
 * Creates exactly three things and nothing else:
 *   1. one SUPERADMIN user, from `SEED_ADMIN_EMAIL`
 *   2. the four `FeatureFlag` rows named in PRD FR-9.7
 *   3. the `EXAMPLE_IN_UNIVERSITY` institution template, spec from PRD Appendix D.3.1
 *
 * Idempotent: every write is an upsert, so running it twice changes nothing.
 * It seeds no documents, chapters or sources — those come from real use.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Prisma, PrismaClient } from '@prisma/client';
import { PITFALL_SEED } from '@tc/config';

const prisma = new PrismaClient();
const here = dirname(fileURLToPath(import.meta.url));

/**
 * PRD FR-9.7 lists exactly these four flags. Defaults follow PRD §17 (GROBID off until a Phase 2
 * quality review) and §10.1 (Draft runs on the Strong tier).
 */
const FEATURE_FLAGS: ReadonlyArray<{ key: string; enabled: boolean; note: string }> = [
  { key: 'automaticSuggest', enabled: false, note: 'Opt-in, ships Phase 2 week 9 (FR-4.6)' },
  { key: 'grobid', enabled: false, note: 'Off until the Phase 2 quality review (FR-1.7, §17 #8)' },
  { key: 'draftModeStrongTier', enabled: true, note: 'Draft on the Strong tier (§10.1, A.2)' },
  { key: 'livingGapMap', enabled: false, note: 'Phase 3 (§4)' },
  { key: 'autoSources', enabled: false, note: 'ADR-0037: find sources when the library has none' },
  // ADR-0028. Off until the host nginx passes WebSockets to the collab instance.
  { key: 'collaboration', enabled: false, note: 'Live co-authoring (ADR-0028)' },
  // ADR-0124. Off until the owner sets the literature review allowance (migration 0050 too).
  { key: 'literatureReviewBuild', enabled: false, note: 'Whole literature review (ADR-0124)' },
  // Not one of FR-9.7's four. PHASES task 0.10 adds it: the admin page shows "Cost model:
  // UNVERIFIED" until the human fills PRD Appendix E.3 and flips this to true. Seeded so the row
  // exists to flip. Logged in docs/CONSISTENCY_REVIEW.md §3.
  {
    key: 'costModelVerified',
    enabled: false,
    note: 'Human flips after filling Appendix E.3 (PHASES 0.10)',
  },
];

function readTemplateSpec(): Prisma.InputJsonValue {
  const path = join(here, 'seed-data', 'example-template.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Prisma.InputJsonValue;
}

async function main(): Promise<void> {
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  if (!adminEmail) {
    throw new Error('SEED_ADMIN_EMAIL is not set. See .env.example and PRD §13.3.');
  }

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: 'SUPERADMIN' },
    create: { email: adminEmail, name: 'Superadmin', role: 'SUPERADMIN' },
  });
  console.log(`user       SUPERADMIN  ${admin.email}  (${admin.id})`);

  for (const flag of FEATURE_FLAGS) {
    // `update: {}` so a human toggling a flag in the admin UI is not reverted by a re-seed.
    const row = await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: {},
      create: { key: flag.key, enabled: flag.enabled },
    });
    console.log(`flag       ${row.key.padEnd(22)}${String(row.enabled).padEnd(6)}# ${flag.note}`);
  }

  const spec = readTemplateSpec();
  const existing = await prisma.institutionTemplate.findFirst({
    where: { name: 'EXAMPLE_IN_UNIVERSITY' },
  });
  const template = existing
    ? await prisma.institutionTemplate.update({ where: { id: existing.id }, data: { spec } })
    : await prisma.institutionTemplate.create({ data: { name: 'EXAMPLE_IN_UNIVERSITY', spec } });

  console.log(`template   ${template.name}  (${template.id})`);

  // ADR-0039: the pitfall bank's seed, from the specification's evaluation. `update` keeps the
  // statement current if the seed changes; an admin's status change (retired) is kept.
  for (const entry of PITFALL_SEED) {
    await prisma.pitfall.upsert({
      where: { code: entry.code },
      update: {
        topic: entry.topic,
        wrongPattern: entry.wrongPattern,
        pattern: entry.pattern ?? null,
        detection: entry.detection,
        correctStatement: entry.correctStatement,
        severity: entry.severity,
        source: entry.source,
      },
      create: {
        code: entry.code,
        profile: entry.profile,
        topic: entry.topic,
        wrongPattern: entry.wrongPattern,
        pattern: entry.pattern ?? null,
        detection: entry.detection,
        correctStatement: entry.correctStatement,
        severity: entry.severity,
        source: entry.source,
        status: 'APPROVED',
        approvedBy: 'Developer Specification v1.0 (evaluation)',
      },
    });
  }
  console.log(`pitfalls   ${PITFALL_SEED.length} approved entries (ADR-0039)`);
  console.log(
    '           placeholder values for common Indian university conventions. PRD D.3.1 requires\n' +
      '           replacing them with a real university guideline before any real export.',
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('\nSeed complete.');
  })
  .catch(async (error: unknown) => {
    await prisma.$disconnect();
    console.error('Seed failed:', error);
    process.exit(1);
  });
