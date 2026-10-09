/**
 * Evaluation round for strengths and questions for the author (ADR-0131), on the real models from
 * `.env` and the chapters in the database it points at. Reads only; writes nothing.
 * Run: `pnpm --filter @tc/worker exec dotenv -e ../../.env -- tsx
 * scripts/eval-examiner-highlights.ts chapterId …` (at least four).
 *
 * Every section of every chapter is reviewed four times: twice by the examiner the product uses
 * today (`examiner.md`) and twice by the candidate (`examiner_review.md`, with the `<ask>` line the
 * worker would send). Two runs of each, because the examiner's issue lists vary from run to run on
 * the same text (ADR-0111 saw 4 and 15 issues on one chapter): the old prompt's agreement with
 * itself is the floor the candidate is measured against.
 *
 * Checked in code, the criterion fixed before the first run:
 *
 * (a) **Issues no fewer, no worse.** Pooled over the chapters, the candidate's issues and its
 *     blocking issues are each at least 80% of the old prompt's (mean per run); and the blocking
 *     sentences the old prompt finds are found by the candidate about as often as by the old
 *     prompt's own second run (cross recall ≥ self recall − 0.10).
 * (b) **Every strength points at the chapter.** Each kept strength's quote is found, as words, in
 *     the plain text of the chapter sentence it is pinned to (checked again here, apart from the
 *     code that kept it); each chapter gets at least two in every candidate run; and at least 70%
 *     of the model's raw strengths survive the code.
 * (c) **Questions are about the chapter.** Each kept question names a content word of the chapter
 *     and no year or "et al." from outside it; each chapter gets at least three in every candidate
 *     run; and at least 70% of the model's raw questions survive the code.
 *
 * Every strength and question is printed for a person to read; the verdict in the ADR is theirs
 * as much as the script's.
 */

import {
  askPlan,
  buildExaminerReviewHighlightsRequest,
  buildExaminerReviewRequest,
  contentWords,
  createProviders,
  type ExaminerResult,
  examinerReviewSchema,
  examinerSchema,
  type HighlightsInput,
  pickHighlights,
  postProcessExaminer,
  postProcessHighlights,
  type Question,
  questionFault,
  type ReviewSection,
  type ReviewSentence,
  reviewChapter,
  reviewWords,
  type Strength,
  sectionInput,
} from '@tc/ai';
import {
  computeCallCost,
  disciplineProfile,
  loadEnv,
  microToInr,
  suggestDiscipline,
} from '@tc/config';
import { PrismaClient } from '@tc/db';
import { loadPassages } from '../src/jobs/examiner-review.js';

type PmNode = { type?: string; content?: PmNode[]; [key: string]: unknown };

/** A chapter build's pending drafts as plain blocks, so the round can read them (as ADR-0111's). */
function unwrapDrafts(node: PmNode): PmNode {
  if (!node.content) return node;
  const content = node.content.flatMap((child) =>
    child.type === 'draftBlock' ? (child.content ?? []).map(unwrapDrafts) : [unwrapDrafts(child)],
  );
  return { ...node, content };
}

const BUDGET_INR = 25;
const prisma = new PrismaClient();
const llm = createProviders(loadEnv()).llm;
let micro = 0;
let calls = 0;
const outTokens = { old: 0, new: 0, oldCalls: 0, newCalls: 0 };

const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
/**
 * `--old-runs=1` (round 2 on, to stay inside the round budget): one fresh run of the old prompt
 * per chapter, pooled with the two round 1 recorded below — the old prompt has not changed, so
 * its round 1 runs are still samples of it. Self recall then cannot be measured afresh and is
 * round 1's 0.59.
 */
const oldRuns = process.argv.includes('--old-runs=1') ? 1 : 2;
const ROUND1_OLD: Record<string, { issues: [number, number]; blocking: [number, number] }> = {
  '01a0f41c-7d03-70c3-b66f-e1e80713d0b9': { issues: [8, 12], blocking: [4, 7] },
  '01a10bb1-76c5-7e63-a5a7-0838a93ecf8d': { issues: [4, 3], blocking: [4, 3] },
  '01a10c1d-edd6-7da7-945d-f3f4e234f5f0': { issues: [6, 10], blocking: [4, 9] },
  '01a11503-cd92-75a2-a2d2-735c3b08a82a': { issues: [15, 18], blocking: [7, 10] },
  '01a11ca5-515f-75e3-9293-910f6f902171': { issues: [35, 35], blocking: [26, 29] },
};
const ROUND1_SELF_RECALL = 0.59;
if (ids.length < 4) {
  console.log('Give at least four chapter ids.');
  process.exit(1);
}
const rows = await prisma.chapter.findMany({
  where: { id: { in: ids } },
  select: {
    id: true,
    title: true,
    scopeNote: true,
    content: true,
    documentId: true,
    document: { select: { title: true, field: true } },
  },
});

type Run = {
  issues: Array<{ sentenceKey: string; severity: string; type: string }>;
  strengths: Array<Strength & { sentence: ReviewSentence; section: string }>;
  questions: Array<Question & { section: string }>;
  raw: { strengths: number; questions: number; strengthsKept: number; questionsKept: number };
  faults: string[];
};

async function call<T>(
  request: Parameters<typeof llm.complete>[0],
  candidate: boolean,
): Promise<T | null> {
  if (microToInr(micro) > BUDGET_INR) throw new Error(`budget of ₹${BUDGET_INR} reached`);
  calls += 1;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await llm.complete({ ...request, signal: AbortSignal.timeout(180_000) });
      if (candidate) {
        outTokens.new += result.usage.outputTokens;
        outTokens.newCalls += 1;
      } else {
        outTokens.old += result.usage.outputTokens;
        outTokens.oldCalls += 1;
      }
      micro += computeCallCost({
        tier: request.tier,
        modelId: result.modelId,
        usage: result.usage,
      });
      return result.value as T;
    } catch (error) {
      const raw = (error as { raw?: unknown }).raw;
      console.log(
        `    (call failed, attempt ${attempt}: ${String(error).slice(0, 140)}${typeof raw === 'string' ? ` — ${raw.length} chars, ends "${raw.slice(-60)}"` : ''})`,
      );
    }
  }
  return null;
}

async function review(
  chapter: (typeof rows)[number],
  sections: ReviewSection[],
  citations: ReturnType<typeof reviewChapter>['citations'],
  candidate: boolean,
): Promise<Run> {
  const discipline =
    suggestDiscipline(chapter.document.field, chapter.document.title) ?? disciplineProfile(null);
  const paradigm = discipline.defaultParadigms[0] ?? 'experimental';
  const passageFor = await loadPassages(prisma, chapter.documentId, citations);
  const pitfalls = (
    await prisma.pitfall.findMany({
      where: { status: 'APPROVED', profile: { in: [discipline.id, '*'] } },
      select: { code: true, wrongPattern: true, correctStatement: true },
    })
  ).map((p) => ({ code: p.code, wrong: p.wrongPattern, correct: p.correctStatement }));
  const plan = askPlan(sections.map((s) => s.sentences.length));
  const run: Run = {
    issues: [],
    strengths: [],
    questions: [],
    raw: { strengths: 0, questions: 0, strengthsKept: 0, questionsKept: 0 },
    faults: [],
  };
  const perSection: Array<{ strengths: Run['strengths']; questions: Run['questions'] }> = [];

  const outcomes = await Promise.all(
    sections.map(async (section, index) => {
      const input = sectionInput(section, citations, passageFor);
      const examinerInput = {
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
      };
      const value = candidate
        ? await call<import('@tc/ai').ExaminerReviewAnswer>(
            {
              ...buildExaminerReviewHighlightsRequest(
                examinerInput,
                plan[index] ?? {
                  strengths: 0,
                  questions: 0,
                },
              ),
              schema: examinerReviewSchema,
            },
            true,
          )
        : await call<ExaminerResult>(
            {
              ...buildExaminerReviewRequest(examinerInput),
              schema: examinerSchema,
            },
            false,
          );
      return { section, input, value, examinerInput };
    }),
  );

  for (const { section, input, value } of outcomes) {
    if (!value) {
      run.faults.push(`no answer for "${section.title}"`);
      perSection.push({ strengths: [], questions: [] });
      continue;
    }
    const processed = postProcessExaminer(
      { issues: value.issues },
      { sentences: input.sentences, pitfalls: [], discipline: disciplineProfile(null) },
    );
    const byId = new Map(input.sentences.map((s) => [s.id, s.sentence]));
    for (const issue of processed.issues) {
      const sentence = byId.get(issue.sentenceId);
      run.issues.push({
        sentenceKey: `${sentence?.from ?? issue.sentenceId}`,
        severity: issue.severity,
        type: issue.issueType,
      });
    }
    if (!candidate) continue;
    const answer = value as import('@tc/ai').ExaminerReviewAnswer;
    const highlightsInput: HighlightsInput = {
      sentences: input.sentences.map(({ id, text }) => ({ id, text })),
      passages: input.passages,
      title: section.title,
      blockingIds: new Set(
        processed.issues.filter((i) => i.severity === 'blocking').map((i) => i.sentenceId),
      ),
    };
    const kept = postProcessHighlights(answer, highlightsInput);
    run.raw.strengths += answer.strengths.length;
    run.raw.questions += answer.questions.length;
    run.raw.strengthsKept += kept.strengths.length;
    run.raw.questionsKept += kept.questions.length;
    for (const s of answer.strengths) {
      if (!kept.strengths.some((k) => k.quote === s.quote.trim().replace(/^["“]|["”]$/g, ''))) {
        console.log(`      dropped strength [${s.sentenceId}] "${s.quote}"`);
      }
    }
    for (const q of answer.questions) {
      const fault = questionFault(q.question, highlightsInput);
      if (fault) console.log(`      dropped question (${fault}): ${q.question}`);
    }
    perSection.push({
      strengths: kept.strengths.map((s) => ({
        ...s,
        sentence: byId.get(s.sentenceId) as ReviewSentence,
        section: section.title,
      })),
      questions: kept.questions.map((q) => ({ ...q, section: section.title })),
    });
  }
  const picked = pickHighlights(perSection);
  run.strengths = picked.strengths;
  run.questions = picked.questions;
  return run;
}

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

/** Mean share of `a`'s blocking sentences that `b` also found, over pairs where `a` has any. */
function recall(pairs: Array<[Run, Run]>): { value: number; pairs: number } {
  let sum = 0;
  let n = 0;
  for (const [a, b] of pairs) {
    const A = new Set(a.issues.filter((i) => i.severity === 'blocking').map((i) => i.sentenceKey));
    if (A.size === 0) continue;
    const B = new Set(b.issues.filter((i) => i.severity === 'blocking').map((i) => i.sentenceKey));
    sum += [...A].filter((k) => B.has(k)).length / A.size;
    n += 1;
  }
  return { value: n ? sum / n : 1, pairs: n };
}

const pooled = { oldIssues: 0, newIssues: 0, oldBlocking: 0, newBlocking: 0 };
const selfPairs: Array<[Run, Run]> = [];
const crossPairs: Array<[Run, Run]> = [];
const raw = { strengths: 0, strengthsKept: 0, questions: 0, questionsKept: 0 };

for (const chapter of rows) {
  const review0 = reviewChapter(unwrapDrafts(chapter.content as PmNode), chapter.title);
  const sections = review0.sections.filter((s) => s.sentences.length > 0);
  const chapterText = sections
    .map((s) => [s.title, ...s.sentences.map((x) => x.plain)].join(' '))
    .join(' ');
  const chapterTerms = contentWords(chapterText);
  const sentencesCount = sections.reduce((n, s) => n + s.sentences.length, 0);
  console.log(`\n=== ${chapter.document.title.slice(0, 60)} — ${chapter.title}`);
  console.log(`    ${sections.length} sections, ${sentencesCount} sentences`);

  const [oldA, oldB, newA, newB] = await Promise.all([
    review(chapter, sections, review0.citations, false),
    oldRuns === 2 ? review(chapter, sections, review0.citations, false) : Promise.resolve(null),
    review(chapter, sections, review0.citations, true),
    review(chapter, sections, review0.citations, true),
  ]);
  const runs = (oldB ? { oldA, oldB, newA, newB } : { oldA, newA, newB }) as Record<string, Run>;
  for (const [name, run] of Object.entries(runs)) {
    const blocking = run.issues.filter((i) => i.severity === 'blocking').length;
    console.log(
      `  ${name}: ${run.issues.length} issues, ${blocking} blocking${run.faults.length ? ` (${run.faults.join('; ')})` : ''}`,
    );
  }
  const blockingOf = (r: Run) => r.issues.filter((i) => i.severity === 'blocking').length;
  pooled.newIssues += (newA.issues.length + newB.issues.length) / 2;
  pooled.newBlocking += (blockingOf(newA) + blockingOf(newB)) / 2;
  if (oldB) {
    pooled.oldIssues += (oldA.issues.length + oldB.issues.length) / 2;
    pooled.oldBlocking += (blockingOf(oldA) + blockingOf(oldB)) / 2;
    selfPairs.push([oldA, oldB], [oldB, oldA]);
    crossPairs.push([oldA, newA], [oldA, newB], [oldB, newA], [oldB, newB]);
  } else {
    const before = ROUND1_OLD[chapter.id];
    if (!before) throw new Error(`no round 1 baseline for ${chapter.id}`);
    console.log(
      `  round 1 old runs: ${before.issues.join(', ')} issues, ${before.blocking.join(', ')} blocking`,
    );
    pooled.oldIssues += (oldA.issues.length + before.issues[0] + before.issues[1]) / 3;
    pooled.oldBlocking += (blockingOf(oldA) + before.blocking[0] + before.blocking[1]) / 3;
    crossPairs.push([oldA, newA], [oldA, newB]);
  }

  for (const [name, run] of [
    ['newA', newA],
    ['newB', newB],
  ] as const) {
    raw.strengths += run.raw.strengths;
    raw.strengthsKept += run.raw.strengthsKept;
    raw.questions += run.raw.questions;
    raw.questionsKept += run.raw.questionsKept;
    console.log(
      `  ${name} strengths (${run.strengths.length}; raw ${run.raw.strengths}, kept ${run.raw.strengthsKept}):`,
    );
    for (const s of run.strengths) {
      console.log(`    + [${s.section}] "${s.quote}" — ${s.why}`);
    }
    console.log(
      `  ${name} questions (${run.questions.length}; raw ${run.raw.questions}, kept ${run.raw.questionsKept}):`,
    );
    for (const q of run.questions) console.log(`    ? [${q.section}] ${q.question}`);

    const anchored = run.strengths.every((s) =>
      ` ${reviewWords(s.sentence.plain).join(' ')} `.includes(
        ` ${reviewWords(s.quote).join(' ')} `,
      ),
    );
    check(anchored, `${chapter.title} ${name}: every strength's quote is in its sentence`);
    check(run.strengths.length >= 2, `${chapter.title} ${name}: at least two strengths`);
    const specific = run.questions.every((q) =>
      reviewWords(q.question).some((w) => chapterTerms.has(w)),
    );
    check(specific, `${chapter.title} ${name}: every question names the chapter's terms`);
    check(run.questions.length >= 3, `${chapter.title} ${name}: at least three questions`);
  }
  console.log(`  spent so far ₹${microToInr(micro).toFixed(2)}`);
}

console.log('\n=== Pooled');
const self = oldRuns === 2 ? recall(selfPairs) : { value: ROUND1_SELF_RECALL, pairs: 0 };
const cross = recall(crossPairs);
console.log(
  `  issues per run: old ${pooled.oldIssues.toFixed(1)}, new ${pooled.newIssues.toFixed(1)}; blocking: old ${pooled.oldBlocking.toFixed(1)}, new ${pooled.newBlocking.toFixed(1)}`,
);
console.log(
  `  blocking recall: old vs old ${self.value.toFixed(2)} (${self.pairs} pairs), old vs new ${cross.value.toFixed(2)} (${cross.pairs} pairs)`,
);
check(
  pooled.newIssues >= 0.8 * pooled.oldIssues,
  '(a) the candidate finds at least 80% as many issues',
);
check(
  pooled.newBlocking >= 0.8 * pooled.oldBlocking,
  '(a) the candidate finds at least 80% as many blocking issues',
);
check(
  cross.value >= self.value - 0.1,
  '(a) blocking sentences found as often as by a second old run',
);
const sRate = raw.strengths ? raw.strengthsKept / raw.strengths : 0;
const qRate = raw.questions ? raw.questionsKept / raw.questions : 0;
console.log(
  `  raw strengths kept ${raw.strengthsKept}/${raw.strengths} (${(sRate * 100).toFixed(0)}%), raw questions kept ${raw.questionsKept}/${raw.questions} (${(qRate * 100).toFixed(0)}%)`,
);
check(sRate >= 0.7, '(b) at least 70% of the raw strengths anchor to the chapter');
check(qRate >= 0.7, '(c) at least 70% of the raw questions pass the checks');
console.log(`\n${rows.length} chapters, ${calls} calls, ₹${microToInr(micro).toFixed(2)} spent`);
console.log(
  `  output tokens per call (reasoning included): old ${Math.round(outTokens.old / Math.max(1, outTokens.oldCalls))}, new ${Math.round(outTokens.new / Math.max(1, outTokens.newCalls))}`,
);
console.log(failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED:`);
for (const f of failures) console.log(`  - ${f}`);
await prisma.$disconnect();
