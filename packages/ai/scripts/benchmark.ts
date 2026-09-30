/**
 * The benchmark against Jenni.ai — the specification's §13.4, the half a machine can do.
 *
 *   pnpm --filter @tc/ai benchmark [discipline-id]
 *
 * For every case in `fixtures/benchmark/<case>/` — `ours.md` (a chapter built here, as Markdown
 * with `{{cite:ID}}` markers or plain), `jenni.md` (the same input written with Jenni, pasted as
 * text), `case.json` ({ title, discipline, objectives[], passages?: [{id, text}] }) — the
 * deterministic check suite runs over both and prints, per check, how many issues each side
 * raised, then the totals. The blind expert rating the spec also asks for is a person's job; this
 * prints the table they score beside.
 *
 * No model is called. Nothing here is a fixture expectation: the numbers are the answer.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECKS,
  type CheckId,
  disciplineProfile,
  PITFALL_SEED,
  universityProfile,
} from '@tc/config';
import { type CheckContext, type CheckSection, enabledChecks, runChecks } from '../src/index.js';

const ROOT = fileURLToPath(new URL('../../../fixtures/benchmark/', import.meta.url));

type Case = {
  title: string;
  discipline: string;
  objectives?: string[];
  passages?: Array<{ id: string; text: string }>;
  chapterRole?: 'INTRODUCTION' | 'LITERATURE' | 'METHOD' | 'RESULTS' | 'DISCUSSION' | 'CONCLUSION';
};

function contextFor(markdown: string, spec: Case): CheckContext {
  const discipline = disciplineProfile(spec.discipline);
  const section: CheckSection = {
    id: 'chapter',
    title: spec.title,
    blueprintRef: 'benchmark',
    markdown,
    entities: [],
    isObjectives: false,
    generic: false,
    organisation: false,
    summary: false,
    dataOnly: false,
  };
  return {
    discipline,
    university: universityProfile('generic_author_year_v1'),
    chapterRole: spec.chapterRole ?? 'LITERATURE',
    sections: [section],
    entities: [],
    passages: new Map([
      ['chapter', (spec.passages ?? []).map((p) => ({ ...p, sourceId: p.id, year: null }))],
    ]),
    sourceYears: [],
    objectives: spec.objectives ?? [],
    language: 'en',
    knownAbbreviations: [],
    pitfalls: PITFALL_SEED.map((p) => ({
      code: p.code,
      pattern: p.pattern ?? null,
      wrong: p.wrongPattern,
      correct: p.correctStatement,
      severity: p.severity,
    })),
    enabled: enabledChecks(discipline.specialChecks),
    now: new Date(),
  };
}

function main(): void {
  const only = process.argv[2];
  if (!existsSync(ROOT)) {
    console.log(`No benchmark cases: ${ROOT} does not exist. See fixtures/benchmark/README.md.`);
    return;
  }
  const cases = readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(ROOT, name, 'case.json')));
  if (cases.length === 0) {
    console.log('No benchmark cases yet. See fixtures/benchmark/README.md.');
    return;
  }
  const totals = { ours: 0, jenni: 0, oursBlocking: 0, jenniBlocking: 0, cases: 0 };
  for (const name of cases) {
    const dir = join(ROOT, name);
    const spec = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8')) as Case;
    if (only && spec.discipline !== only) continue;
    const sides = (['ours', 'jenni'] as const).filter((side) =>
      existsSync(join(dir, `${side}.md`)),
    );
    if (sides.length < 2) {
      console.log(`${name}: needs both ours.md and jenni.md; has ${sides.join(', ') || 'neither'}`);
      continue;
    }
    totals.cases++;
    const results = Object.fromEntries(
      sides.map((side) => [
        side,
        runChecks(contextFor(readFileSync(join(dir, `${side}.md`), 'utf8'), spec)),
      ]),
    );
    console.log(`\n== ${name} — ${spec.title} (${spec.discipline})`);
    console.log(`${'check'.padEnd(44)} ${'ours'.padStart(6)} ${'jenni'.padStart(6)}`);
    for (const id of Object.keys(CHECKS) as CheckId[]) {
      const ours = results.ours?.issues.filter((i) => i.checkId === id).length ?? 0;
      const jenni = results.jenni?.issues.filter((i) => i.checkId === id).length ?? 0;
      if (ours === 0 && jenni === 0) continue;
      console.log(
        `${`${id} ${CHECKS[id].label}`.slice(0, 44).padEnd(44)} ${String(ours).padStart(6)} ${String(jenni).padStart(6)}`,
      );
    }
    const blocking = (side: 'ours' | 'jenni') =>
      results[side]?.issues.filter((i) => i.severity === 'blocking').length ?? 0;
    console.log(
      `${'blocking issues'.padEnd(44)} ${String(blocking('ours')).padStart(6)} ${String(blocking('jenni')).padStart(6)}`,
    );
    console.log(
      `${'copied twelve-word runs'.padEnd(44)} ${String(results.ours?.similarity.copiedRuns ?? 0).padStart(6)} ${String(results.jenni?.similarity.copiedRuns ?? 0).padStart(6)}`,
    );
    totals.ours += results.ours?.issues.length ?? 0;
    totals.jenni += results.jenni?.issues.length ?? 0;
    totals.oursBlocking += blocking('ours');
    totals.jenniBlocking += blocking('jenni');
  }
  console.log(
    `\n${totals.cases} case(s). Issues: ours ${totals.ours} (${totals.oursBlocking} blocking), Jenni ${totals.jenni} (${totals.jenniBlocking} blocking). Fewer is better; the expert rating decides the rest.`,
  );
}

main();
