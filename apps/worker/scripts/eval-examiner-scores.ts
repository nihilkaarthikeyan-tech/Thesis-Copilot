/**
 * Evaluation round for the examiner's score card (ADR-0111), on the real models from `.env` and
 * the chapters in the database it points at. Writes nothing.
 * Run: `pnpm --filter @tc/worker exec dotenv -e ../../.env -- tsx scripts/eval-examiner-scores.ts
 * [chapterId …]`. With no ids, it takes up to four chapters of different theses with at least
 * three sections and 600 words.
 *
 * Each chapter goes through what a real review does first — the per-section examiner, with the
 * passages its citations point at (`loadPassages`) — so the score card sees the issues it would
 * see in the product. A chapter build's pending drafts are read as text here (a review skips
 * them); they are real model-written chapters with real citations, and the round has no others.
 *
 * A new prompt has no current version to beat, so the round checks in code what a grade must do,
 * and prints every card for a person to read:
 *
 * - **Stable:** the same chapter and issues scored twice; every score within one point.
 * - **Presentation falls** when each section's sentences are shuffled and the sections reversed.
 * - **Soundness falls** when the chapter is made to contradict itself and the issue list says so,
 *   judged on the model's own number, before the code's ceiling of 6.
 * - **Contribution falls** when the chapter is cut to its first section.
 */

import {
  buildExaminerReviewRequest,
  buildExaminerScoresRequest,
  cleanExaminerScores,
  createProviders,
  type ExaminerScores,
  examinerSchema,
  examinerScoresSchema,
  postProcessExaminer,
  type ReviewSection,
  reviewChapter,
  SCORE_NAMES,
  type ScoreIssue,
  sectionInput,
  soundnessBlocking,
} from '@tc/ai';
import { disciplineProfile, loadEnv, suggestDiscipline } from '@tc/config';
import { PrismaClient } from '@tc/db';
import { loadPassages } from '../src/jobs/examiner-review.js';

type PmNode = { type?: string; content?: PmNode[]; [key: string]: unknown };

/** A chapter build's pending drafts as plain blocks, so the round can read them. */
function unwrapDrafts(node: PmNode): PmNode {
  if (!node.content) return node;
  const content = node.content.flatMap((child) =>
    child.type === 'draftBlock' ? (child.content ?? []).map(unwrapDrafts) : [unwrapDrafts(child)],
  );
  return { ...node, content };
}

const prisma = new PrismaClient();
const llm = createProviders(loadEnv()).llm;
let calls = 0;
let tokens = 0;

const survey = process.argv.includes('--survey');
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const rows = await prisma.chapter.findMany({
  where: ids.length ? { id: { in: ids } } : {},
  select: {
    id: true,
    title: true,
    scopeNote: true,
    content: true,
    documentId: true,
    document: { select: { title: true, field: true } },
  },
});

type Picked = (typeof rows)[number] & {
  sections: ReviewSection[];
  review: ReturnType<typeof reviewChapter>;
  words: number;
};
const picked: Picked[] = [];
const seenTheses = new Set<string>();
for (const row of rows.sort(
  (a, b) => JSON.stringify(b.content).length - JSON.stringify(a.content).length,
)) {
  const review = reviewChapter(unwrapDrafts(row.content as PmNode), row.title);
  const sections = review.sections.filter((s) => s.sentences.length > 0);
  const words = sections.reduce(
    (n, s) => n + s.sentences.reduce((m, x) => m + x.plain.split(/\s+/).length, 0),
    0,
  );
  const thesis = row.document.title.slice(0, 40);
  if (survey) {
    console.log(
      `${row.id} | ${sections.length} sections | ${words} words | ${thesis} | ${row.title}`,
    );
    continue;
  }
  if (!ids.length && (sections.length < 3 || words < 600 || seenTheses.has(thesis))) continue;
  seenTheses.add(thesis);
  picked.push({ ...row, sections, review, words });
  if (!ids.length && picked.length >= 4) break;
}

if (survey) {
  await prisma.$disconnect();
  process.exit(0);
}

async function examine(chapter: Picked): Promise<ScoreIssue[]> {
  const discipline =
    suggestDiscipline(chapter.document.field, chapter.document.title) ?? disciplineProfile(null);
  const paradigm = discipline.defaultParadigms[0] ?? 'experimental';
  const passageFor = await loadPassages(prisma, chapter.documentId, chapter.review.citations);
  const pitfalls = (
    await prisma.pitfall.findMany({
      where: { status: 'APPROVED', profile: { in: [discipline.id, '*'] } },
      select: { code: true, wrongPattern: true, correctStatement: true },
    })
  ).map((p) => ({ code: p.code, wrong: p.wrongPattern, correct: p.correctStatement }));
  const issues: ScoreIssue[] = [];
  for (const [index, section] of chapter.sections.entries()) {
    const input = sectionInput(section, chapter.review.citations, passageFor);
    const request = buildExaminerReviewRequest({
      discipline,
      paradigm,
      degree: 'PhD',
      section: {
        id: `sec${index + 1}`,
        title: section.title,
        purpose: chapter.scopeNote ?? '',
        isSummary: section.isSummary,
      },
      sentences: input.sentences.map(({ id, text }) => ({ id, text })),
      entities: [],
      passages: input.passages,
      terminology: discipline.terminology,
      pitfalls,
      userId: 'eval',
      documentId: 'eval',
    });
    calls += 1;
    try {
      const result = await llm.complete({
        ...request,
        signal: AbortSignal.timeout(180_000),
        schema: examinerSchema,
      });
      tokens += result.usage.inputTokens + result.usage.outputTokens;
      const processed = postProcessExaminer(result.value, {
        sentences: input.sentences,
        pitfalls,
        discipline,
      });
      for (const issue of processed.issues) {
        issues.push({
          severity: issue.severity,
          type: issue.issueType,
          section: section.title,
          explanation: issue.explanation || 'The examiner flagged this sentence.',
        });
      }
    } catch (error) {
      console.log(`    (examiner failed for "${section.title}": ${String(error).slice(0, 120)})`);
    }
  }
  return issues;
}

async function score(
  chapter: Picked,
  sections: ReviewSection[],
  issues: ScoreIssue[],
): Promise<{ raw: ExaminerScores; card: ExaminerScores | null }> {
  const discipline =
    suggestDiscipline(chapter.document.field, chapter.document.title) ?? disciplineProfile(null);
  const req = buildExaminerScoresRequest({
    discipline: discipline.displayName,
    degree: 'PhD',
    chapterTitle: chapter.title,
    purpose: chapter.scopeNote ?? '',
    sections,
    issues,
    userId: 'eval',
    documentId: 'eval',
  });
  calls += 1;
  const result = await llm.complete({
    ...req,
    signal: AbortSignal.timeout(180_000),
    schema: examinerScoresSchema,
  });
  tokens += result.usage.inputTokens + result.usage.outputTokens;
  const raw = result.value as ExaminerScores;
  return { raw, card: cleanExaminerScores(raw, { blocking: soundnessBlocking(issues) }) };
}

/** A fixed shuffle (seeded), so a rerun shuffles the same way. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const line = (card: ExaminerScores | null) =>
  card ? SCORE_NAMES.map((n) => `${n[0]?.toUpperCase()}${card[n].score}`).join(' ') : 'NO CARD';

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

for (const chapter of picked) {
  const { sections } = chapter;
  console.log(`\n=== ${chapter.document.title.slice(0, 60)} — ${chapter.title}`);
  console.log(`    ${sections.length} sections, ${chapter.words} words`);
  const issues = await examine(chapter);
  const blocking = issues.filter((i) => i.severity === 'blocking').length;
  console.log(`    examiner: ${issues.length} issues, ${blocking} blocking`);

  const a1 = await score(chapter, sections, issues);
  const a2 = await score(chapter, sections, issues);
  console.log(
    `  original      ${line(a1.card)}   again ${line(a2.card)}   (model's soundness ${a1.raw.soundness.score}, ${a2.raw.soundness.score})`,
  );
  const readingOf = (r: unknown) => (r as { reading?: string }).reading ?? '';
  console.log(`    reading: ${readingOf(a1.raw)}`);
  for (const n of SCORE_NAMES) console.log(`    ${n}: ${a1.card?.[n].reason ?? ''}`);

  const scrambled = [...sections].reverse().map((s, i) => ({
    ...s,
    sentences: shuffled(s.sentences, 17 + i),
  }));
  const b = await score(chapter, scrambled, issues);
  console.log(`  scrambled     ${line(b.card)}`);
  console.log(`    reading: ${readingOf(b.raw)}`);
  console.log(`    presentation: ${b.card?.presentation.reason ?? ''}`);

  const opening = sections[0]?.sentences[0]?.plain ?? '';
  const denial = `Contrary to what was said at the start of this chapter, it is not the case that ${opening.replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/\.$/, '')}.`;
  const last = sections[sections.length - 1] as ReviewSection;
  const contradicted = [
    ...sections.slice(0, -1),
    {
      ...last,
      sentences: [
        ...last.sentences,
        { marked: denial, plain: denial, from: 0, to: 0, citations: [] },
      ],
    },
  ];
  const c = await score(chapter, contradicted, [
    ...issues,
    {
      severity: 'blocking',
      type: 'contradiction',
      section: last.title,
      explanation: `This section denies the chapter's opening claim ("${opening.slice(0, 120)}"), so the chapter contradicts itself.`,
    },
  ]);
  console.log(`  contradicted  ${line(c.card)}   (model's soundness ${c.raw.soundness.score})`);
  console.log(`    soundness: ${c.card?.soundness.reason ?? ''}`);

  const first = sections[0] as ReviewSection;
  const d = await score(
    chapter,
    [first],
    issues.filter((i) => i.section === first.title),
  );
  console.log(`  first only    ${line(d.card)}`);
  console.log(`    contribution: ${d.card?.contribution.reason ?? ''}`);

  if (!a1.card || !a2.card || !b.card || !c.card || !d.card) {
    check(false, 'every run gave a full card');
    continue;
  }
  const base = a1.card;
  const again = a2.card;
  check(
    SCORE_NAMES.every((n) => Math.abs(base[n].score - again[n].score) <= 1),
    'stable: every score within one point on a second run',
  );
  check(b.card.presentation.score < base.presentation.score, 'scrambled: presentation falls');
  check(
    c.raw.soundness.score < Math.max(a1.raw.soundness.score, a2.raw.soundness.score) ||
      c.raw.soundness.score <= 2,
    'contradicted: soundness falls (or is already at the floor)',
  );
  check(
    d.card.contribution.score < base.contribution.score,
    'first section only: contribution falls',
  );
}

console.log(`\n${picked.length} chapters, ${calls} calls, ${tokens.toLocaleString()} tokens`);
console.log(failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED:`);
for (const f of failures) console.log(`  - ${f}`);
await prisma.$disconnect();
