/**
 * `chapter-build` — ADR-0039. One chapter: planned from the discipline's blueprint and the
 * thesis's key terms, written one section at a time from the library through the draft path
 * (A.2), joined in code, checked in code, reviewed by the examiner, the flagged sentences fixed
 * once, and delivered as pending draft blocks the student accepts, with the QA report.
 *
 * The worker owns the build's state (QUEUED → RUNNING → DONE | REFUSED | FAILED), as it owns a
 * coherence run's: a student who closes the tab still comes back to a finished build. A build
 * that wrote nothing (no sources anywhere, or a provider outage) gives its unit back.
 *
 * Nothing here writes thesis text. Every section lands as a `draftBlock` with `status: pending`
 * and `DRAFT` provenance; the student accepts or discards each (Appendix B.6).
 */

import {
  assembleSections,
  buildDraftRequest,
  buildEntitiesRequest,
  buildExaminerRequest,
  buildFixRequest,
  buildProofreadRequest,
  CHAPTER_BUILD,
  type CheckContext,
  type CheckPassage,
  type CheckPitfall,
  type CheckSection,
  coverageOf,
  DRAFT,
  draftToProseMirror,
  type EmbeddingProvider,
  type ExaminerIssue,
  enabledChecks,
  entitiesSchema,
  examinerSchema,
  examinerSentences,
  type LlmProvider,
  type LlmRequest,
  PROOFREAD,
  type PromptPassage,
  postProcessDraft,
  postProcessEntities,
  postProcessExaminer,
  postProcessProofread,
  proofreadSchema,
  type RawIssue,
  runChecks,
  sentencesOf,
  unchangedSentencesKept,
} from '@tc/ai';
import {
  applicableElements,
  type BlueprintElement,
  blueprintFor,
  CHECKS,
  type ChapterRole,
  type CheckId,
  type DisciplineProfile,
  disciplineProfile,
  languageSetting,
  PARADIGMS,
  type Paradigm,
  TEMPLATE_SPECS,
  type Template,
  type UniversityProfile,
  universityProfile,
} from '@tc/config';
import type { PrismaClient } from '@tc/db';
import { type ContextChapter, docToText, shortReference } from '@tc/retrieval';
import {
  type BuildEntity,
  type BuildProgress,
  CHAPTER_BUILD_MAX_SECTIONS,
  type ChapterBuildJob,
  type ChapterBuildPlan,
  type ChapterBuildReport,
  type PlanSection,
  type ReportCheck,
  type ReportReference,
  type ReportSection,
  readOutline,
  readThesisDetails,
  type ValidationIssue,
} from '@tc/types';

// --------------------------------------------------------------------------------------------
// Dependencies
// --------------------------------------------------------------------------------------------

type Usage = {
  inputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
};

export type BuildCallLog = {
  userId: string;
  documentId: string;
  tier: 'fast' | 'strong';
  modelId: string;
  usage: Usage | null;
  latencyMs: number;
  ok: boolean;
  error?: string;
};

export type Retrieved = {
  passages: Array<PromptPassage & { sourceId: string; chunkId: string }>;
  byKey: Map<string, { sourceId: string; chunkId: string; shortRef: string }>;
};

export type ChapterBuildDeps = {
  prisma: PrismaClient;
  llm: LlmProvider;
  embeddings: EmbeddingProvider;
  /** The A.0.1 block, built by the same code the API uses. */
  memoryBlock: (chapter: ContextChapter) => Promise<string>;
  /** §10.4 retrieval over the chapter's pins, or the whole library when nothing is pinned. */
  retrieve: (chapter: ContextChapter, query: string) => Promise<Retrieved>;
  /** Writes a `DocumentVersion` of the chapter before the build changes it. */
  snapshot: (input: { documentId: string; chapterId: string; content: unknown }) => Promise<void>;
  /** Writes the `AiCallLog` row and returns its cost in micro-INR. */
  logCall: (call: BuildCallLog) => Promise<number>;
  /** Gives the `CHAPTER_BUILD` unit back (a build that delivered nothing). */
  refund: (userId: string) => Promise<void>;
  /** The site-wide budget (ADR-0037's guard); throws when reached. */
  assertBudget?: () => Promise<void>;
  /**
   * Spec stage 4: "search the user's library first, then the discipline's databases". Asks for
   * papers on a section the library does not cover (ADR-0037's search); resolves true when a
   * search was started. Optional: without it the build writes from the library alone.
   */
  findSources?: (input: { chapterId: string; query: string }) => Promise<boolean>;
  /** For the wait between polls while found papers are indexed; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
};

/** How long a build waits for papers it asked for to be indexed before writing without them. */
export const EVIDENCE_WAIT = {
  /** Give up on a search that has added nothing after this long. */
  noneAddedMs: 75_000,
  /** The most a build waits for added papers to finish indexing. */
  maxMs: 4 * 60_000,
  pollMs: 10_000,
} as const;

export type ChapterBuildResult = {
  buildId: string;
  status: 'DONE' | 'REFUSED' | 'FAILED';
  sections: number;
  drafted: number;
  blockingOpen: number;
  spentInr: number;
};

// --------------------------------------------------------------------------------------------
// The run
// --------------------------------------------------------------------------------------------

type DraftedSection = PlanSection & {
  markdown: string;
  passages: Array<PromptPassage & { sourceId: string; chunkId: string }>;
  byKey: Map<string, { sourceId: string; chunkId: string; shortRef: string }>;
  needsSource: string[];
  words: number;
  citations: number;
  status: ReportSection['status'];
  note?: string;
  fixed: boolean;
  /** Citation markers the model invented and the whitelist removed (E6, §10.6). */
  hallucinated: number;
};

export async function runChapterBuild(
  job: ChapterBuildJob,
  deps: ChapterBuildDeps,
): Promise<ChapterBuildResult> {
  const log = deps.log ?? (() => undefined);
  const now = deps.now ?? (() => new Date());
  const prisma = deps.prisma;
  let spentMicro = 0;

  const build = await prisma.chapterBuild.findUnique({ where: { id: job.buildId } });
  if (build?.status !== 'QUEUED') {
    return {
      buildId: job.buildId,
      status: 'FAILED',
      sections: 0,
      drafted: 0,
      blockingOpen: 0,
      spentInr: 0,
    };
  }

  const progress = async (p: BuildProgress) => {
    await prisma.chapterBuild.update({
      where: { id: job.buildId },
      data: { progress: p, status: 'RUNNING' },
    });
  };

  const finish = async (
    status: 'DONE' | 'REFUSED' | 'FAILED',
    data: { plan?: ChapterBuildPlan; report?: ChapterBuildReport; error?: string },
    counts: { sections: number; drafted: number; blockingOpen: number },
  ): Promise<ChapterBuildResult> => {
    await prisma.chapterBuild.update({
      where: { id: job.buildId },
      data: {
        status,
        finishedAt: now(),
        ...(data.plan ? { plan: data.plan } : {}),
        ...(data.report ? { report: data.report } : {}),
        ...(data.error ? { error: data.error.slice(0, 1000) } : {}),
      },
    });
    if (status !== 'DONE') await deps.refund(job.userId).catch(() => undefined);
    log({
      msg: 'chapter build finished',
      buildId: job.buildId,
      status,
      ...counts,
      spentInr: spentMicro / 1e6,
    });
    return { buildId: job.buildId, status, ...counts, spentInr: spentMicro / 1e6 };
  };

  try {
    await progress({ stage: 'loading', sectionsTotal: 0, sectionsDone: 0 });
    await deps.assertBudget?.();

    // ---- 0. Load ------------------------------------------------------------------------------
    const [document, memory, chapter] = await Promise.all([
      prisma.document.findFirst({
        where: { id: job.documentId, ownerId: job.userId },
        select: { id: true, title: true, field: true, language: true, template: true, meta: true },
      }),
      prisma.documentMemory.findUnique({
        where: { documentId: job.documentId },
        select: { scope: true, outline: true, glossary: true },
      }),
      prisma.chapter.findFirst({
        where: { id: job.chapterId, documentId: job.documentId },
        select: {
          id: true,
          documentId: true,
          outlineNodeId: true,
          title: true,
          order: true,
          scopeNote: true,
          content: true,
          version: true,
        },
      }),
    ]);
    if (!document || !chapter) {
      return finish(
        'FAILED',
        { error: 'The chapter no longer exists.' },
        { sections: 0, drafted: 0, blockingOpen: 0 },
      );
    }

    const discipline = disciplineProfile(job.profile.disciplineId);
    const university = universityProfile(job.profile.universityId);
    const paradigm: Paradigm = (PARADIGMS as readonly string[]).includes(job.profile.paradigm)
      ? (job.profile.paradigm as Paradigm)
      : (discipline.defaultParadigms[0] ?? 'experimental');
    const outline = readOutline(memory?.outline);
    const role = chapterRoleOf(chapter, outline, document.template);
    const blueprint = blueprintFor(role);
    if (!blueprint) {
      return finish(
        'REFUSED',
        {
          error:
            'This chapter is the student’s own published paper; a chapter build does not write it.',
        },
        { sections: 0, drafted: 0, blockingOpen: 0 },
      );
    }

    const scope =
      (memory?.scope as {
        workingTitle?: string;
        objectives?: string[];
        problemStatement?: string;
      } | null) ?? {};
    const objectives = (scope.objectives ?? [])
      .map((o) => String(o).trim())
      .filter((o) => o.length > 0);
    const details = readThesisDetails(
      (document.meta as Record<string, unknown> | null)?.thesisDetails,
    );
    const glossary = (memory?.glossary as Record<string, unknown> | null) ?? {};
    const contextChapter: ContextChapter = {
      id: chapter.id,
      documentId: chapter.documentId,
      outlineNodeId: chapter.outlineNodeId,
      title: chapter.title,
      scopeNote: chapter.scopeNote,
      content: chapter.content,
      language: job.profile.language ?? document.language,
    };

    // ---- 2. Entities --------------------------------------------------------------------------
    await progress({ stage: 'extracting', sectionsTotal: 0, sectionsDone: 0 });
    // The plan step (API) already extracted the key terms and the student confirmed them; a build
    // that arrives with them uses them as they are and asks the model nothing.
    const planned = build.plan as Partial<ChapterBuildPlan> | null;
    const confirmed = Array.isArray(planned?.entities)
      ? (planned?.entities as BuildEntity[])
      : null;
    const clarifications = (planned?.clarifications ?? []).filter((q) => q.answer);
    let entities: BuildEntity[] = confirmed ?? [];
    if (!confirmed && (objectives.length > 0 || document.title)) {
      const input = {
        title: document.title,
        objectives,
        questions: [] as string[],
        hypotheses: [] as string[],
        entityTypes: discipline.entityTypes,
        userId: job.userId,
        documentId: job.documentId,
      };
      const request = buildEntitiesRequest(input);
      const started = Date.now();
      try {
        const result = await deps.llm.complete({ ...request, schema: entitiesSchema });
        spentMicro += await deps.logCall({
          userId: job.userId,
          documentId: job.documentId,
          tier: 'fast',
          modelId: result.modelId,
          usage: result.usage,
          latencyMs: Date.now() - started,
          ok: true,
        });
        entities = postProcessEntities(result.value, input);
      } catch (error) {
        spentMicro += await deps.logCall({
          userId: job.userId,
          documentId: job.documentId,
          tier: 'fast',
          modelId: deps.llm.modelIdFor('fast'),
          usage: null,
          latencyMs: Date.now() - started,
          ok: false,
          error: String(error instanceof Error ? error.message : error).slice(0, 500),
        });
        log({
          msg: 'entity extraction failed; building without key terms',
          buildId: job.buildId,
          error: String(error),
        });
      }
    }

    // ---- 3. Plan ------------------------------------------------------------------------------
    await progress({ stage: 'planning', sectionsTotal: 0, sectionsDone: 0 });
    const elements = applicableElements(blueprint, {
      paradigm,
      requiresTheoreticalFramework: discipline.requiresTheoreticalFramework,
      chapterSummaryRequired: university.chapterSummaryRequired,
      disabled: job.profile.disabledElements ?? [],
    });
    const outlineNode = outline.find((n) => n.id === chapter.outlineNodeId);
    const sections = planSections(
      elements,
      entities,
      objectives,
      discipline,
      outlineNode?.children ?? [],
    );
    const plan: ChapterBuildPlan = {
      chapterRole: role,
      entities,
      sections,
      coverage: {},
      uncovered: [],
      clarifications: planned?.clarifications ?? [],
      confirmedAt: planned?.confirmedAt ?? null,
    };
    await prisma.chapterBuild.update({ where: { id: job.buildId }, data: { plan } });

    // ---- 4. Evidence: the library first, then the databases (ADR-0037's search) ---------------
    const evidenceStarted = now();
    let searches = 0;
    if (deps.findSources) {
      for (const section of sections) {
        if (section.noEvidence) continue;
        await progress({
          stage: 'evidence',
          sectionsTotal: sections.length,
          sectionsDone: searches,
          note: section.title,
        });
        const query = [
          section.title,
          section.instructions,
          ...section.entities.map((id) => entityText(entities, id)),
        ]
          .filter(Boolean)
          .join('. ');
        const found = await deps
          .retrieve(contextChapter, query)
          .catch(() => ({ passages: [], byKey: new Map() }) as Retrieved);
        if (found.passages.length > 0) continue;
        const started = await deps
          .findSources({ chapterId: chapter.id, query: `${document.title}. ${query}` })
          .catch(() => false);
        if (started) searches++;
      }
      if (searches > 0) {
        await waitForFoundSources(
          prisma,
          job.documentId,
          evidenceStarted,
          deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
          now,
          (note) => progress({ stage: 'evidence', sectionsTotal: 0, sectionsDone: 0, note }),
        );
      }
    }

    // ---- 5. Drafting, one section at a time ---------------------------------------------------
    const memoryBlock = await deps.memoryBlock(contextChapter);
    const existingText = docToText(chapter.content);
    const drafted: DraftedSection[] = [];
    let done = 0;
    for (const section of sections) {
      await progress({
        stage: 'drafting',
        sectionsTotal: sections.length,
        sectionsDone: done,
        note: section.title,
      });
      const query = [
        section.title,
        section.instructions,
        ...section.entities.map((id) => entityText(entities, id)),
      ]
        .filter(Boolean)
        .join('. ');
      const retrieved = await deps
        .retrieve(contextChapter, query)
        .catch(() => ({ passages: [], byKey: new Map() }) as Retrieved);
      const passages = retrieved.passages.slice(0, DRAFT.topK);

      if (passages.length === 0 && !section.noEvidence) {
        drafted.push({
          ...section,
          markdown: '',
          passages: [],
          byKey: new Map(),
          needsSource: [],
          words: 0,
          citations: 0,
          status: 'refused',
          note: 'No source in the library covers this section. Add or pin sources and build again.',
          fixed: false,
          hallucinated: 0,
        });
        done++;
        continue;
      }

      const scopeNote = scopeNoteFor(
        section,
        entities,
        objectives,
        outline,
        drafted,
        discipline,
        university,
        clarifications,
      );
      const request = buildDraftRequest({
        memoryBlock,
        section: {
          outlineNodeId: section.outlineNodeId ?? section.id,
          title: section.title,
          scopeNote,
          children: [],
        },
        passages,
        targetWords: section.targetWords,
        tier: 'strong',
        userId: job.userId,
        documentId: job.documentId,
      });
      const outcome = await streamText(deps, request, job, (micro) => {
        spentMicro += micro;
      });
      if (outcome.error) {
        drafted.push({
          ...section,
          markdown: '',
          passages,
          byKey: retrieved.byKey,
          needsSource: [],
          words: 0,
          citations: 0,
          status: 'error',
          note: 'The section could not be written (provider error).',
          fixed: false,
          hallucinated: 0,
        });
        done++;
        continue;
      }
      const processed = postProcessDraft(
        outcome.text,
        passages,
        section.targetWords,
        `${existingText}\n${drafted.map((d) => d.markdown).join('\n')}`,
      );
      drafted.push({
        ...section,
        markdown: processed.result.markdown,
        passages,
        byKey: retrieved.byKey,
        needsSource: processed.result.needsSource,
        words: processed.result.words,
        citations: processed.result.citations.length,
        // No words is no section: a draft the quality filters emptied, or one that came back as
        // bare citation markers, is not delivered.
        status: processed.result.words === 0 ? 'refused' : 'drafted',
        ...(processed.result.words === 0
          ? { note: 'The sources did not cover this section; nothing usable was written.' }
          : {}),
        fixed: false,
        hallucinated: processed.hallucinated.length,
      });
      done++;
    }

    const written = drafted.filter((d) => d.status === 'drafted');
    if (written.length === 0) {
      const report = buildReport(
        drafted,
        [],
        [],
        { copiedRuns: 0, checkedWords: 0 },
        [],
        [],
        discipline,
        university,
        spentMicro,
        {
          duplicates: 0,
          spacing: 0,
          dangling: 0,
          roadmap: 0,
          proofread: 0,
          hallucinated: 0,
        },
      );
      return finish(
        'REFUSED',
        {
          plan,
          report,
          error: 'No section could be written: the library has no source that covers this chapter.',
        },
        { sections: sections.length, drafted: 0, blockingOpen: 0 },
      );
    }

    // ---- 6. Assembly (code only) ---------------------------------------------------------------
    await progress({ stage: 'assembling', sectionsTotal: sections.length, sectionsDone: done });
    const assembled = assembleSections(
      written.map((d) => ({ id: d.id, markdown: d.markdown, organisation: d.organisation })),
      existingText,
    );
    for (const a of assembled.sections) {
      const d = written.find((w) => w.id === a.id);
      if (d) d.markdown = a.markdown;
    }

    // ---- 6b. Spelling, grammar and punctuation (L6): the proofreader, in code's hands ----------
    // The fast model proposes corrections in batches of forty sentences; `postProcessProofread`
    // keeps only what `correctionSize` allows (a spelling, an inflection, a grammar word,
    // punctuation — never a different word, ADR-0026), and the accepted ones are applied to the
    // draft before delivery. Counted as corrected, like the assembler's own fixes.
    let proofread = 0;
    if (languageSetting(job.profile.language ?? document.language).proofread) {
      for (const section of written) {
        const sentences = sentencesOf(section.markdown)
          .map((text, i) => ({
            id: `s${i + 1}`,
            raw: text,
            text: text.replace(/\{\{cite:[^}]+\}\}/g, '').trim(),
          }))
          .filter((s) => s.text.length >= 20);
        for (let from = 0; from < sentences.length; from += PROOFREAD.batch) {
          const batch = sentences.slice(from, from + PROOFREAD.batch);
          const request = buildProofreadRequest({
            sentences: batch.map((s) => ({ id: s.id, text: s.text })),
            language: job.profile.language ?? document.language,
            userId: job.userId,
            documentId: job.documentId,
          });
          const started = Date.now();
          try {
            const result = await deps.llm.complete({ ...request, schema: proofreadSchema });
            spentMicro += await deps.logCall({
              userId: job.userId,
              documentId: job.documentId,
              tier: 'fast',
              modelId: result.modelId,
              usage: result.usage,
              latencyMs: Date.now() - started,
              ok: true,
            });
            const checked = postProcessProofread(
              result.value,
              batch.map((s) => ({ id: s.id, text: s.text })),
            );
            for (const c of checked.corrections) {
              const target = batch.find((s) => s.id === c.sentenceId);
              if (!target?.raw.includes(c.original)) continue;
              const fixedRaw = target.raw.replace(c.original, c.replacement);
              if (!section.markdown.includes(target.raw)) continue;
              section.markdown = section.markdown.replace(target.raw, fixedRaw);
              target.raw = fixedRaw;
              proofread++;
            }
          } catch (error) {
            spentMicro += await deps.logCall({
              userId: job.userId,
              documentId: job.documentId,
              tier: 'fast',
              modelId: deps.llm.modelIdFor('fast'),
              usage: null,
              latencyMs: Date.now() - started,
              ok: false,
              error: String(error instanceof Error ? error.message : error).slice(0, 500),
            });
          }
        }
      }
    }

    // ---- 7. Checks ----------------------------------------------------------------------------
    await progress({ stage: 'checking', sectionsTotal: sections.length, sectionsDone: done });
    const pitfallRows = await prisma.pitfall.findMany({
      where: { status: 'APPROVED', profile: { in: [discipline.id, '*'] } },
      select: {
        code: true,
        pattern: true,
        wrongPattern: true,
        correctStatement: true,
        severity: true,
      },
    });
    const pitfalls: CheckPitfall[] = pitfallRows.map((p) => ({
      code: p.code,
      pattern: p.pattern,
      wrong: p.wrongPattern,
      correct: p.correctStatement,
      severity: p.severity === 'warning' ? 'warning' : 'blocking',
    }));
    const sourceIds = [...new Set(written.flatMap((d) => d.passages.map((p) => p.sourceId)))];
    const sources = await prisma.source.findMany({
      where: { id: { in: sourceIds } },
      select: {
        id: true,
        title: true,
        authors: true,
        year: true,
        doi: true,
        status: true,
        groundingLevel: true,
      },
    });
    const sourceById = new Map(sources.map((s) => [s.id, s]));
    const enabled = enabledChecks(discipline.specialChecks);
    const knownAbbreviations = [...Object.keys(details.abbreviations), ...Object.keys(glossary)];

    const checkContext = (): CheckContext => ({
      discipline,
      university,
      chapterRole: role,
      sections: written.map(toCheckSection),
      entities,
      passages: new Map(
        written.map((d) => [
          d.id,
          d.passages.map(
            (p): CheckPassage => ({
              id: p.id,
              text: p.text,
              sourceId: p.sourceId,
              year: sourceById.get(p.sourceId)?.year ?? null,
            }),
          ),
        ]),
      ),
      sourceYears: citedSources(written).map((id) => sourceById.get(id)?.year ?? Number.NaN),
      objectives,
      language: job.profile.language ?? document.language,
      knownAbbreviations,
      pitfalls,
      enabled,
      now: now(),
    });

    const pass1 = runChecks(checkContext());
    const referenceIssues = referenceChecks(written, sourceById, enabled);
    plan.coverage = Object.fromEntries(coverageOf(entities, written));
    plan.uncovered = pass1.issues.filter((i) => i.checkId === 'S1').map((i) => i.sentence);

    // ---- 7b. Examiner -------------------------------------------------------------------------
    const examinerIssues = new Map<string, ExaminerIssue[]>();
    let examined = 0;
    for (const section of written) {
      await progress({
        stage: 'examining',
        sectionsTotal: written.length,
        sectionsDone: examined,
        note: section.title,
      });
      const sentences = examinerSentences(section.markdown);
      if (sentences.length === 0) {
        examined++;
        continue;
      }
      const request = buildExaminerRequest({
        discipline,
        paradigm,
        degree: details.degree || 'thesis',
        section: {
          id: section.id,
          title: section.title,
          purpose: section.purpose,
          isSummary: section.summary,
        },
        sentences,
        entities: section.entities
          .map((id) => entities.find((e) => e.id === id))
          .filter((e): e is BuildEntity => Boolean(e)),
        passages: section.passages.map((p) => ({ id: p.id, text: p.text })),
        terminology: discipline.terminology,
        pitfalls: pitfalls.map((p) => ({ code: p.code, wrong: p.wrong, correct: p.correct })),
        ...(section.summary
          ? {
              chapterOutline: written
                .filter((w) => w.id !== section.id)
                .map((w) => ({
                  title: w.title,
                  opening: sentencesOf(w.markdown).slice(0, 2).join(' '),
                })),
            }
          : {}),
        userId: job.userId,
        documentId: job.documentId,
      });
      const started = Date.now();
      try {
        const result = await deps.llm.complete({ ...request, schema: examinerSchema });
        spentMicro += await deps.logCall({
          userId: job.userId,
          documentId: job.documentId,
          tier: 'strong',
          modelId: result.modelId,
          usage: result.usage,
          latencyMs: Date.now() - started,
          ok: true,
        });
        const processed = postProcessExaminer(result.value, {
          sentences,
          pitfalls: pitfalls.map((p) => ({ code: p.code, wrong: p.wrong, correct: p.correct })),
          discipline,
        });
        examinerIssues.set(section.id, processed.issues);
        if (processed.dropped > 0)
          log({
            msg: 'examiner named sentences not sent',
            buildId: job.buildId,
            dropped: processed.dropped,
          });
      } catch (error) {
        spentMicro += await deps.logCall({
          userId: job.userId,
          documentId: job.documentId,
          tier: 'strong',
          modelId: deps.llm.modelIdFor('strong'),
          usage: null,
          latencyMs: Date.now() - started,
          ok: false,
          error: String(error instanceof Error ? error.message : error).slice(0, 500),
        });
        log({
          msg: 'examiner failed for a section; its checks stand',
          buildId: job.buildId,
          section: section.id,
          error: String(error),
        });
      }
      examined++;
    }

    // ---- 8. One fix loop ----------------------------------------------------------------------
    const issues: ValidationIssue[] = [];
    let issueSeq = 0;
    const addIssue = (raw: RawIssue, by: 'code' | 'examiner', pass: 1 | 2): ValidationIssue => {
      const issue: ValidationIssue = {
        id: `i${++issueSeq}`,
        checkId: raw.checkId,
        severity: raw.severity,
        sectionId: raw.sectionId,
        sentence: raw.sentence,
        explanation: raw.explanation,
        suggestedFix: raw.suggestedFix,
        status: 'open',
        by,
        pass,
        ...(raw.pitfallCode ? { pitfallCode: raw.pitfallCode } : {}),
      };
      issues.push(issue);
      return issue;
    };
    for (const raw of [...pass1.issues, ...referenceIssues]) addIssue(raw, 'code', 1);
    for (const [sectionId, list] of examinerIssues) {
      for (const e of list) {
        addIssue(
          {
            checkId: e.checkId,
            severity: e.severity,
            sectionId,
            sentence: e.sentence.replace(/\{\{cite:[^}]+\}\}/g, '').trim(),
            explanation: e.explanation,
            suggestedFix: e.correction,
            ...(e.pitfallCode ? { pitfallCode: e.pitfallCode } : {}),
          },
          'examiner',
          1,
        );
      }
    }

    const fixable = written
      .map((section) => ({
        section,
        blocking: issues.filter(
          (i) => i.sectionId === section.id && i.severity === 'blocking' && i.sentence.length > 0,
        ),
      }))
      .filter((s) => s.blocking.length > 0)
      .sort((a, b) => b.blocking.length - a.blocking.length)
      .slice(0, Math.floor(CHAPTER_BUILD_MAX_SECTIONS / 2));

    let fixedCount = 0;
    for (const { section, blocking } of fixable) {
      await progress({
        stage: 'fixing',
        sectionsTotal: fixable.length,
        sectionsDone: fixedCount,
        note: section.title,
      });
      const request = buildFixRequest({
        section: { title: section.title, markdown: section.markdown },
        issues: blocking.map((i) => ({
          sentence: i.sentence,
          explanation: i.explanation,
          correction: i.suggestedFix,
        })),
        passages: section.passages.map((p) => ({ id: p.id, text: p.text })),
        userId: job.userId,
        documentId: job.documentId,
      });
      const outcome = await streamText(deps, request, job, (micro) => {
        spentMicro += micro;
      });
      if (outcome.error || outcome.text.trim().length === 0) continue;
      const processed = postProcessDraft(
        outcome.text,
        section.passages,
        section.targetWords,
        existingText,
      );
      const kept = unchangedSentencesKept(
        section.markdown,
        processed.result.markdown,
        blocking.map((i) => i.sentence),
      );
      if (kept.ratio < CHAPTER_BUILD.keepRatio) {
        log({
          msg: 'fix rejected: it changed sentences it was not asked to',
          buildId: job.buildId,
          section: section.id,
          ...kept,
        });
        continue;
      }
      section.markdown = processed.result.markdown;
      section.needsSource = [...new Set([...section.needsSource, ...processed.result.needsSource])];
      section.words = processed.result.words;
      section.citations = processed.result.citations.length;
      section.fixed = true;
      fixedCount++;
    }

    // ---- 7 again: the deterministic checks on what will be delivered ---------------------------
    if (fixedCount > 0) {
      const pass2 = runChecks(checkContext());
      const stillOpen = new Set(pass2.issues.map(issueKey));
      for (const issue of issues) {
        if (issue.by !== 'code' || issue.sectionId === 'chapter' || issue.checkId === 'E3')
          continue;
        const section = written.find((w) => w.id === issue.sectionId);
        if (section?.fixed && !stillOpen.has(issueKey(issue))) issue.status = 'fixed';
      }
      for (const raw of pass2.issues) {
        const key = issueKey(raw);
        if (!issues.some((i) => issueKey(i) === key && i.status === 'open'))
          addIssue(raw, 'code', 2);
      }
      for (const issue of issues) {
        if (issue.by !== 'examiner') continue;
        const section = written.find((w) => w.id === issue.sectionId);
        if (
          section?.fixed &&
          issue.sentence &&
          !section.markdown.replace(/\{\{cite:[^}]+\}\}/g, '').includes(issue.sentence)
        ) {
          issue.status = 'fixed';
        }
      }
      pass1.similarity = pass2.similarity;
    }

    // Pitfall hits (spec §8.2: "track hit counts").
    const hits = new Map<string, number>();
    for (const issue of issues)
      if (issue.pitfallCode) hits.set(issue.pitfallCode, (hits.get(issue.pitfallCode) ?? 0) + 1);
    for (const [code, n] of hits) {
      await prisma.pitfall
        .update({ where: { code }, data: { hits: { increment: n } } })
        .catch(() => undefined);
    }

    // ---- 9. Deliver ---------------------------------------------------------------------------
    await progress({ stage: 'delivering', sectionsTotal: written.length, sectionsDone: 0 });
    const blocks: unknown[] = [];
    const draftIds = new Map<string, string>();
    for (const section of written) {
      const event = await prisma.suggestionEvent.create({
        data: {
          userId: job.userId,
          documentId: job.documentId,
          chapterId: chapter.id,
          action: 'CHAPTER_BUILD',
          shownChars: section.markdown.length,
          outcome: 'SHOWN',
          latencyMs: 0,
          guided: false,
        },
        select: { id: true },
      });
      draftIds.set(section.id, event.id);
      const provenance = { type: 'provenance', attrs: { kind: 'DRAFT', actionId: event.id } };
      const body = draftToProseMirror(section.markdown, event.id, (key) => {
        const real = section.byKey.get(key);
        return real ? { sourceId: real.sourceId, chunkId: real.chunkId } : null;
      });
      const notes = section.needsSource.map((note) => ({
        type: 'paragraph',
        content: [{ type: 'needsSourceNote', attrs: { text: note } }],
      }));
      blocks.push({
        type: 'draftBlock',
        attrs: { draftId: event.id, status: 'pending' },
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: section.title, marks: [provenance] }],
          },
          ...body,
          ...notes,
        ],
      });
    }

    await deps.snapshot({
      documentId: job.documentId,
      chapterId: chapter.id,
      content: chapter.content,
    });
    const current = (chapter.content as { type?: string; content?: unknown[] } | null) ?? {};
    const nextContent = {
      type: 'doc',
      content: [...(Array.isArray(current.content) ? current.content : []), ...blocks],
    };
    const counts = provenanceWordCounts(nextContent);
    const updated = await prisma.chapter.updateMany({
      where: { id: chapter.id, version: chapter.version },
      data: {
        content: nextContent as never,
        wordCounts: counts as never,
        wordCount: Object.values(counts).reduce((a, b) => a + b, 0),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      // The student saved while the build ran. Append to what they saved rather than lose either.
      const latest = await prisma.chapter.findUnique({
        where: { id: chapter.id },
        select: { content: true, version: true },
      });
      const latestContent = (latest?.content as { content?: unknown[] } | null) ?? {};
      const merged = {
        type: 'doc',
        content: [
          ...(Array.isArray(latestContent.content) ? latestContent.content : []),
          ...blocks,
        ],
      };
      const mergedCounts = provenanceWordCounts(merged);
      await prisma.chapter.update({
        where: { id: chapter.id },
        data: {
          content: merged as never,
          wordCounts: mergedCounts as never,
          wordCount: Object.values(mergedCounts).reduce((a, b) => a + b, 0),
          version: { increment: 1 },
        },
      });
    }

    const report = buildReport(
      drafted.map((d) => ({ ...d, draftId: draftIds.get(d.id) ?? null })),
      issues,
      [...enabled],
      pass1.similarity,
      citedSources(written).map((id): ReportReference => {
        const s = sourceById.get(id);
        return {
          sourceId: id,
          shortRef: shortReference(s?.authors, s?.year ?? null, s?.title ?? null) ?? 'Source',
          title: s?.title ?? null,
          year: s?.year ?? null,
          doi: s?.doi ?? null,
          status: s?.status ?? 'UNKNOWN',
          grounding: s?.groundingLevel ?? 'NONE',
          uses: written.reduce((n, w) => n + w.passages.filter((p) => p.sourceId === id).length, 0),
        };
      }),
      drafted.flatMap((d) => d.needsSource.map((note) => ({ sectionId: d.id, note }))),
      discipline,
      university,
      spentMicro,
      {
        ...assembled.counts,
        proofread,
        hallucinated: written.reduce((n, w) => n + w.hallucinated, 0),
      },
    );
    const blockingOpen = report.totals.blockingOpen;
    return finish(
      'DONE',
      { plan, report },
      { sections: sections.length, drafted: written.length, blockingOpen },
    );
  } catch (error) {
    log({ msg: 'chapter build failed', buildId: job.buildId, error: String(error) });
    return finish(
      'FAILED',
      { error: error instanceof Error ? error.message : String(error) },
      { sections: 0, drafted: 0, blockingOpen: 0 },
    );
  }
}

// --------------------------------------------------------------------------------------------
// Planning
// --------------------------------------------------------------------------------------------

/** The chapter's role: the outline node's, else the title's, else the template's by position. */
export function chapterRoleOf(
  chapter: { title: string; order: number; outlineNodeId: string },
  outline: ReturnType<typeof readOutline>,
  template: Template | null,
): ChapterRole {
  const node = outline.find((n) => n.id === chapter.outlineNodeId) as { role?: string } | undefined;
  const roles: ChapterRole[] = [
    'INTRODUCTION',
    'LITERATURE',
    'METHOD',
    'RESULTS',
    'DISCUSSION',
    'CONCLUSION',
    'PAPER',
  ];
  if (node?.role && (roles as string[]).includes(node.role)) return node.role as ChapterRole;
  const title = chapter.title.toLowerCase();
  if (/introduction/.test(title)) return 'INTRODUCTION';
  if (/literature|review|related work|background/.test(title)) return 'LITERATURE';
  if (/method|materials and|experimental|design of/.test(title)) return 'METHOD';
  if (/result|finding|analysis/.test(title)) return 'RESULTS';
  if (/discussion/.test(title)) return 'DISCUSSION';
  if (/conclusion|summary and|future/.test(title)) return 'CONCLUSION';
  if (template) return TEMPLATE_SPECS[template].chapters[chapter.order]?.role ?? 'DISCUSSION';
  return 'DISCUSSION';
}

const entityText = (entities: readonly BuildEntity[], id: string): string =>
  entities.find((e) => e.id === id)?.text ?? '';

/**
 * Instantiates the blueprint: one section per element; for `perEntityGroup` elements one per
 * group of key terms (by type, in the profile's order), or one per objective in a Results or
 * Discussion chapter. Capped at `CHAPTER_BUILD_MAX_SECTIONS` by merging the smallest groups.
 */
export function planSections(
  elements: readonly BlueprintElement[],
  entities: readonly BuildEntity[],
  objectives: readonly string[],
  discipline: DisciplineProfile,
  outlineChildren: ReadonlyArray<{ id: string; title: string }>,
): PlanSection[] {
  const sections: PlanSection[] = [];
  const fixedCount = elements.filter((e) => !e.perEntityGroup).length;
  const room = Math.max(1, CHAPTER_BUILD_MAX_SECTIONS - fixedCount);

  const base = (
    element: BlueprintElement,
    title: string,
    ents: string[],
    purposeSuffix = '',
  ): PlanSection => ({
    id: `s${sections.length + 1}`,
    title,
    blueprintRef: element.key,
    purpose: `${element.purpose}${purposeSuffix}`,
    instructions: element.instructions,
    entities: ents,
    targetWords: element.targetWords ?? DRAFT.defaultTargetWords,
    isObjectives: Boolean(element.isObjectives),
    generic: Boolean(element.generic),
    organisation: Boolean(element.organisation),
    summary: Boolean(element.summary),
    dataOnly: Boolean(element.dataOnly),
    noEvidence: Boolean(element.noEvidence),
    outlineNodeId: matchOutlineChild(title, outlineChildren),
  });

  for (const element of elements) {
    if (!element.perEntityGroup) {
      sections.push(base(element, element.title, []));
      continue;
    }
    const byObjective = element.key.startsWith('results.') || element.key.startsWith('discussion.');
    if (byObjective) {
      const list = objectives.length > 0 ? objectives : ['the objectives'];
      const groups = list.slice(0, room);
      groups.forEach((objective, i) => {
        const ents = entities.filter((e) => e.sourceObjective === i + 1).map((e) => e.id);
        sections.push(
          base(
            element,
            `${element.title.replace(/ by objective$/i, '').replace(/^Interpretation by key result$/, 'Interpretation')}: objective ${i + 1}`,
            ents,
            ` Objective ${i + 1}: ${objective}`,
          ),
        );
      });
      continue;
    }
    const groups = groupEntities(entities, discipline, room);
    if (groups.length === 0) {
      sections.push(base(element, element.title, []));
      continue;
    }
    for (const group of groups) {
      sections.push(
        base(
          element,
          `${element.title}: ${group.label}`,
          group.entities.map((e) => e.id),
        ),
      );
    }
  }

  // Every key term the objectives use must be introduced before them (S1). A term no group took
  // (an unknown type) is given to the first subject section.
  const objectivesIndex = sections.findIndex((s) => s.isObjectives);
  const subject = sections.find(
    (s, i) => (objectivesIndex === -1 || i < objectivesIndex) && s.entities.length > 0,
  );
  if (subject) {
    const assigned = new Set(sections.flatMap((s) => s.entities));
    for (const entity of entities) {
      if (entity.sourceObjective > 0 && !assigned.has(entity.id)) subject.entities.push(entity.id);
    }
  }
  return sections.slice(0, CHAPTER_BUILD_MAX_SECTIONS);
}

function groupEntities(
  entities: readonly BuildEntity[],
  discipline: DisciplineProfile,
  room: number,
): Array<{ label: string; entities: BuildEntity[] }> {
  const order = discipline.entityTypes.map((t) => t.code);
  const groups = new Map<string, BuildEntity[]>();
  for (const entity of entities) {
    const list = groups.get(entity.type) ?? [];
    list.push(entity);
    groups.set(entity.type, list);
  }
  let ordered = [...groups.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([type, list]) => ({
      label: labelFor(type, list, discipline),
      entities: list,
    }));
  while (ordered.length > room && ordered.length > 1) {
    const last = ordered.pop() as { label: string; entities: BuildEntity[] };
    const target = ordered[ordered.length - 1] as { label: string; entities: BuildEntity[] };
    target.entities.push(...last.entities);
    target.label = `${target.label} and ${last.label}`;
  }
  ordered = ordered.map((g) => ({
    ...g,
    label: g.label.length > 80 ? `${g.label.slice(0, 77)}…` : g.label,
  }));
  return ordered;
}

function labelFor(
  type: string,
  list: readonly BuildEntity[],
  discipline: DisciplineProfile,
): string {
  if (list.length <= 3) return list.map((e) => e.text).join(', ');
  return discipline.entityTypes.find((t) => t.code === type)?.label ?? type;
}

function matchOutlineChild(
  title: string,
  children: ReadonlyArray<{ id: string; title: string }>,
): string | null {
  const key = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim();
  const words = key.split(/\s+/).filter((w) => w.length > 3);
  for (const child of children) {
    const childKey = child.title
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .trim();
    if (childKey === key) return child.id;
    if (words.length > 0 && words.every((w) => childKey.includes(w))) return child.id;
  }
  return null;
}

/**
 * The scope note the draft prompt receives for a section: the blueprint's instructions, the key
 * terms to introduce, and for the special elements the material they are written from (the
 * objectives verbatim; the chapter list for the organisation section; the other sections'
 * openings for the summary).
 */
function scopeNoteFor(
  section: PlanSection,
  entities: readonly BuildEntity[],
  objectives: readonly string[],
  outline: ReturnType<typeof readOutline>,
  drafted: readonly DraftedSection[],
  discipline: DisciplineProfile,
  university: UniversityProfile,
  clarifications: ReadonlyArray<{
    entityId: string | null;
    question: string;
    answer: string | null;
  }> = [],
): string {
  const parts = [section.instructions];
  // The student's answers to the intake questions, for the sections that introduce the term
  // asked about (or every section, for a question about the thesis as a whole).
  const relevant = clarifications.filter(
    (q) => q.answer && (q.entityId === null || section.entities.includes(q.entityId)),
  );
  if (relevant.length > 0) {
    parts.push(
      `The student clarified: ${relevant.map((q) => `${q.question} — ${q.answer}`).join(' | ')}`,
    );
  }
  const ents = section.entities
    .map((id) => entities.find((e) => e.id === id))
    .filter((e): e is BuildEntity => Boolean(e));
  if (ents.length > 0) {
    parts.push(
      `Introduce and define, in this order: ${ents.map((e) => `${e.text} (${e.type.toLowerCase().replace(/_/g, ' ')})`).join('; ')}.`,
    );
  }
  if (section.isObjectives && objectives.length > 0) {
    parts.push(
      `The objectives, verbatim:\n${objectives.map((o, i) => `${i + 1}. ${o}`).join('\n')}`,
    );
  }
  if (section.organisation && outline.length > 0) {
    parts.push(
      `The chapters, in order: ${outline.map((n, i) => `Chapter ${i + 1}: ${n.title} — ${n.scopeNote}`).join(' | ')}`,
    );
  }
  if (section.summary) {
    const openings = drafted
      .filter((d) => d.status === 'drafted')
      .map(
        (d) =>
          `${d.title}: ${sentencesOf(d.markdown)
            .slice(0, 2)
            .join(' ')
            .replace(/\{\{cite:[^}]+\}\}/g, '')}`,
      );
    if (openings.length > 0)
      parts.push(
        `The chapter contains these sections; summarise only them:\n${openings.join('\n')}`,
      );
  }
  if (section.dataOnly) {
    parts.push(
      'Write only from the passages, which are the student’s own data. Where a number is not in them, write [[DATA NEEDED: what is missing]] on its own line and give no figure.',
    );
  }
  parts.push(`Spelling: ${university.spelling}. Discipline: ${discipline.displayName}.`);
  return parts.join('\n');
}

// --------------------------------------------------------------------------------------------
// Checks that read the database, and the report
// --------------------------------------------------------------------------------------------

const toCheckSection = (d: DraftedSection): CheckSection => ({
  id: d.id,
  title: d.title,
  blueprintRef: d.blueprintRef,
  markdown: d.markdown,
  entities: d.entities,
  isObjectives: d.isObjectives,
  generic: d.generic,
  organisation: d.organisation,
  summary: d.summary,
  dataOnly: d.dataOnly,
});

/** Sources the delivered sections cite, by the citation markers that survived the whitelist. */
function citedSources(written: readonly DraftedSection[]): string[] {
  const ids = new Set<string>();
  for (const section of written) {
    for (const match of section.markdown.matchAll(/\{\{cite:([^}]+)\}\}/g)) {
      const real = section.byKey.get((match[1] ?? '').trim());
      if (real) ids.add(real.sourceId);
    }
  }
  return [...ids];
}

/** E3: every cited source resolved to a real record. */
function referenceChecks(
  written: readonly DraftedSection[],
  sourceById: ReadonlyMap<
    string,
    { status: string; title: string | null; authors: unknown; year: number | null }
  >,
  enabled: ReadonlySet<CheckId>,
): RawIssue[] {
  if (!enabled.has('E3')) return [];
  return citedSources(written)
    .filter((id) => sourceById.get(id)?.status !== 'RESOLVED')
    .map((id) => {
      const s = sourceById.get(id);
      return {
        checkId: 'E3' as const,
        severity: 'blocking' as const,
        sectionId: 'chapter',
        sentence: shortReference(s?.authors, s?.year ?? null, s?.title ?? null) ?? 'A source',
        explanation: `This source's record is ${(s?.status ?? 'unknown').toLowerCase()}: it could not be matched to a real publication.`,
        suggestedFix: 'Open it in Sources and resolve it (add the DOI), or remove the citation.',
      };
    });
}

const issueKey = (i: { checkId: string; sectionId: string; sentence: string }): string =>
  `${i.checkId}|${i.sectionId}|${i.sentence.slice(0, 120)}`;

function buildReport(
  drafted: ReadonlyArray<DraftedSection & { draftId?: string | null }>,
  issues: readonly ValidationIssue[],
  enabled: readonly CheckId[],
  similarity: { copiedRuns: number; checkedWords: number },
  references: readonly ReportReference[],
  evidenceNeeded: ReadonlyArray<{ sectionId: string; note: string }>,
  discipline: DisciplineProfile,
  university: UniversityProfile,
  spentMicro: number,
  assembly: {
    duplicates: number;
    spacing: number;
    dangling: number;
    roadmap: number;
    proofread: number;
    hallucinated: number;
  },
): ChapterBuildReport {
  const open = (id: string) => issues.filter((i) => i.checkId === id && i.status === 'open');
  const fixedFor = (id: string) =>
    issues.filter((i) => i.checkId === id && i.status === 'fixed').length;
  const corrected: Partial<Record<CheckId, number>> = {
    L1: assembly.duplicates,
    L2: assembly.spacing,
    L6: assembly.proofread,
    L7: assembly.dangling,
    L8: assembly.roadmap,
    E6: assembly.hallucinated,
  };
  const checks: ReportCheck[] = (Object.keys(CHECKS) as CheckId[]).map((id) => {
    const spec = CHECKS[id];
    const isEnabled = enabled.includes(id);
    const openHere = open(id);
    const status: ReportCheck['status'] = !isEnabled
      ? 'skipped'
      : openHere.some((i) => i.severity === 'blocking')
        ? 'fail'
        : openHere.length > 0
          ? 'warn'
          : 'pass';
    return {
      checkId: id,
      label: spec.label,
      status,
      open: openHere.length,
      fixed: fixedFor(id),
      ...(corrected[id] !== undefined ? { corrected: corrected[id] } : {}),
      ...(spec.by === 'examiner' && isEnabled ? { note: 'Judged by the examiner review.' } : {}),
      ...(spec.by === 'assembly' && isEnabled
        ? { note: 'Corrected in code before delivery.' }
        : {}),
    };
  });
  const sections: ReportSection[] = drafted.map((d) => {
    const openHere = issues.filter((i) => i.sectionId === d.id && i.status === 'open');
    const status: ReportSection['status'] =
      d.status !== 'drafted'
        ? d.status
        : openHere.some((i) => i.severity === 'blocking')
          ? 'failed_validation'
          : d.fixed
            ? 'fixed'
            : 'passed';
    return {
      id: d.id,
      title: d.title,
      blueprintRef: d.blueprintRef,
      status,
      words: d.words,
      citations: d.citations,
      needsSource: d.needsSource,
      draftId: d.draftId ?? null,
      ...(d.note ? { note: d.note } : {}),
    };
  });
  const openIssues = issues.filter((i) => i.status === 'open');
  return {
    sections,
    checks,
    issues: [...issues],
    evidenceNeeded: [...evidenceNeeded],
    references: [...references],
    similarity,
    totals: {
      words: drafted.reduce((n, d) => n + d.words, 0),
      citations: drafted.reduce((n, d) => n + d.citations, 0),
      blockingOpen: openIssues.filter((i) => i.severity === 'blocking').length,
      warningsOpen: openIssues.filter((i) => i.severity === 'warning').length,
      fixed: issues.filter((i) => i.status === 'fixed').length,
      spentInr: Math.round(spentMicro / 10_000) / 100,
    },
    disclosure:
      'Parts of this chapter were drafted with an AI writing assistant (Thesis Copilot) from sources I selected. I reviewed, edited and accepted every passage, and I am responsible for the content and the citations.',
    ...(discipline.sensitiveNote ? { sensitiveNote: discipline.sensitiveNote } : {}),
    universityUnconfirmed: !university.confirmed,
  };
}

// --------------------------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------------------------

/**
 * Waits for the papers a search added (`Source.autoAddedAt` after the build began) to be indexed —
 * resolved and given a grounding level — so the drafts can cite them. Gives up when a search adds
 * nothing within `noneAddedMs`, and always by `maxMs`; the build then writes from what there is.
 */
export async function waitForFoundSources(
  prisma: PrismaClient,
  documentId: string,
  since: Date,
  sleep: (ms: number) => Promise<void>,
  now: () => Date,
  note: (text: string) => Promise<unknown>,
): Promise<{ added: number; indexed: number }> {
  const start = now().getTime();
  let added = 0;
  let indexed = 0;
  while (now().getTime() - start < EVIDENCE_WAIT.maxMs) {
    const rows = await prisma.source.findMany({
      where: { documentId, autoAddedAt: { gte: since } },
      select: { status: true, groundingLevel: true },
    });
    added = rows.length;
    indexed = rows.filter(
      (r) => r.groundingLevel !== 'NONE' || r.status === 'FAILED' || r.status === 'UNRESOLVED',
    ).length;
    if (added > 0 && indexed === added) break;
    if (added === 0 && now().getTime() - start >= EVIDENCE_WAIT.noneAddedMs) break;
    await note(
      added === 0
        ? 'Searching the literature for sections the library does not cover…'
        : `Reading ${added} paper(s) found for this chapter (${indexed} ready)…`,
    );
    await sleep(EVIDENCE_WAIT.pollMs);
  }
  return { added, indexed };
}

async function streamText(
  deps: ChapterBuildDeps,
  request: LlmRequest,
  job: ChapterBuildJob,
  spend: (micro: number) => void,
): Promise<{ text: string; error: boolean }> {
  let text = '';
  let usage: Usage | null = null;
  let modelId = deps.llm.modelIdFor(request.tier);
  const started = Date.now();
  try {
    for await (const chunk of deps.llm.stream(request)) {
      if (chunk.type === 'text') text += chunk.text;
      else {
        usage = chunk.usage;
        modelId = chunk.modelId;
      }
    }
  } catch (error) {
    spend(
      await deps.logCall({
        userId: job.userId,
        documentId: job.documentId,
        tier: request.tier,
        modelId,
        usage: null,
        latencyMs: Date.now() - started,
        ok: false,
        error: String(error instanceof Error ? error.message : error).slice(0, 500),
      }),
    );
    return { text: '', error: true };
  }
  spend(
    await deps.logCall({
      userId: job.userId,
      documentId: job.documentId,
      tier: request.tier,
      modelId,
      usage,
      latencyMs: Date.now() - started,
      ok: true,
    }),
  );
  return { text, error: false };
}

/** B.4 word counts by provenance, so the chapter row stays truthful after the build writes it. */
export function provenanceWordCounts(
  doc: unknown,
): Record<'HUMAN' | 'ASSIST' | 'DRAFT' | 'COMMAND' | 'HUMAN_EDITED', number> {
  const counts = { HUMAN: 0, ASSIST: 0, DRAFT: 0, COMMAND: 0, HUMAN_EDITED: 0 };
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      type?: string;
      text?: string;
      marks?: Array<{ type?: string; attrs?: { kind?: string } }>;
      content?: unknown[];
    };
    if (n.type === 'text' && typeof n.text === 'string') {
      const kind = n.marks?.find((m) => m.type === 'provenance')?.attrs?.kind;
      const key = (kind && kind in counts ? kind : 'HUMAN') as keyof typeof counts;
      counts[key] += n.text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    }
    for (const child of n.content ?? []) walk(child);
  };
  walk(doc);
  return counts;
}
