/**
 * Chapter build — ADR-0039: the three model calls the pipeline makes beyond the draft path it
 * already had. Entity extraction (fast tier, once per build), the examiner review of one section
 * (strong tier) and the fix of a section's flagged sentences (strong tier).
 *
 * The rules the rest of the product holds are held here in code, not in the prompts:
 *
 * - **Grounding (§10.6).** An entity whose text is not in the student's own inputs is dropped. An
 *   examiner issue naming a sentence id that was not sent is dropped. A fix may only cite passages
 *   in the request, and every sentence it was not asked to change must still be present, or the
 *   whole fix is rejected (`unchangedSentencesKept`).
 * - **Nothing invented.** The examiner's `correction` is text for the report and for the fixer;
 *   the only correction a deterministic check ever offers is a pitfall entry's correct statement.
 * - **Metered and logged** under `CHAPTER_BUILD`, one unit per build, taken by the API before the
 *   job is queued.
 */

import type { CheckId, DisciplineProfile, EntityType, TerminologyRule } from '@tc/config';
import type { BuildEntity } from '@tc/types';
import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';
import { splitSentences } from './quality.js';

export const CHAPTER_BUILD = {
  entities: { tier: 'fast', maxTokens: 1_200, temperature: 0 },
  examiner: { tier: 'strong', maxTokens: 1_500, temperature: 0 },
  fix: { tier: 'strong', maxTokens: 1_500, temperature: 0.2 },
  maxEntities: 25,
  maxIssuesPerSection: 20,
  /** A sentence shorter than this is not sent to the examiner: a heading or a fragment. */
  minSentenceChars: 20,
  /** Passages the examiner sees per section (its evidence pack, cut). */
  maxPassages: 12,
  /** Share of unflagged sentences a fix must keep for it to be accepted. */
  keepRatio: 0.9,
  /**
   * The most one model call may take. On the second real build (2026-10-01) an examiner call
   * hung for an hour (the SDK's own ceiling) and the next for seven and a half, and the build
   * took 8 h 34 min instead of eight minutes. A call that passes this is a failed call: the
   * section keeps its deterministic checks and the build goes on.
   */
  callTimeoutMs: 180_000,
} as const;

// --------------------------------------------------------------------------------------------
// Shared: the request's own tags stripped from student text, so a tag cannot close a block.
// --------------------------------------------------------------------------------------------

const OWN_TAGS =
  /<\/?(?:entity_types|type|thesis|objective|question|hypothesis|review|section|s|entities|entity|passages|passage|terminology|term|pitfalls|pitfall|focus|item|chapter|fix|issues|issue|ask)\b[^>]*>/gi;
export const cleanBuildText = (text: string): string => text.replace(OWN_TAGS, '').trim();
const attr = (text: string): string => cleanBuildText(text).replace(/"/g, '”');

const system = (name: 'entities' | 'examiner' | 'fix_flagged') => ({
  cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt(name).system}`,
});

// --------------------------------------------------------------------------------------------
// Entity extraction
// --------------------------------------------------------------------------------------------

export const entitiesSchema = z.object({
  entities: z.array(
    z.object({
      text: z.string(),
      type: z.string(),
      sourceObjective: z.number(),
      aliases: z.array(z.string()),
    }),
  ),
});
export type EntitiesResult = z.infer<typeof entitiesSchema>;

export type EntitiesInput = {
  title: string;
  objectives: readonly string[];
  questions: readonly string[];
  hypotheses: readonly string[];
  entityTypes: readonly EntityType[];
  userId: string;
  documentId: string;
};

export function buildEntitiesRequest(input: EntitiesInput): Omit<LlmRequest, 'schema'> {
  const user = [
    '<entity_types>',
    ...input.entityTypes.map(
      (t) => `<type code="${attr(t.code)}">${cleanBuildText(t.hint)}</type>`,
    ),
    '</entity_types>',
    `<thesis title="${attr(input.title)}">`,
    ...input.objectives.map((o, i) => `<objective n="${i + 1}">${cleanBuildText(o)}</objective>`),
    ...input.questions.map((q) => `<question>${cleanBuildText(q)}</question>`),
    ...input.hypotheses.map((h) => `<hypothesis>${cleanBuildText(h)}</hypothesis>`),
    '</thesis>',
  ].join('\n');
  return {
    tier: CHAPTER_BUILD.entities.tier,
    system: system('entities'),
    messages: [{ role: 'user', content: user }],
    maxTokens: CHAPTER_BUILD.entities.maxTokens,
    temperature: CHAPTER_BUILD.entities.temperature,
    action: 'CHAPTER_BUILD',
    userId: input.userId,
    documentId: input.documentId,
  };
}

const norm = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[₀-₉]/g, (d) => String(d.charCodeAt(0) - 0x2080))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Keeps only terms that are in the inputs, with a known type, once each. The id is positional
 * (`E01`…) so the plan and the report can refer to it.
 */
export function postProcessEntities(
  result: EntitiesResult,
  input: Pick<EntitiesInput, 'title' | 'objectives' | 'questions' | 'hypotheses' | 'entityTypes'>,
): BuildEntity[] {
  const haystack = norm(
    [input.title, ...input.objectives, ...input.questions, ...input.hypotheses].join(' \n '),
  );
  const codes = new Set(input.entityTypes.map((t) => t.code));
  const fallback = input.entityTypes[0]?.code ?? 'TERM';
  const seen = new Set<string>();
  const out: BuildEntity[] = [];
  for (const raw of result.entities) {
    const text = raw.text.trim();
    const key = norm(text);
    if (key.length < 2 || seen.has(key)) continue;
    if (!haystack.includes(key)) continue;
    seen.add(key);
    const aliases = raw.aliases
      .map((a) => a.trim())
      .filter((a) => a.length > 0 && norm(a) !== key && haystack.includes(norm(a)));
    out.push({
      id: `E${String(out.length + 1).padStart(2, '0')}`,
      text,
      type: codes.has(raw.type) ? raw.type : fallback,
      ...(codes.has(raw.type) ? {} : { typeUnknown: true }),
      aliases: [...new Set(aliases)],
      sourceObjective: Math.max(
        0,
        Math.min(input.objectives.length, Math.floor(raw.sourceObjective)),
      ),
      coveredBy: [],
    });
    if (out.length >= CHAPTER_BUILD.maxEntities) break;
  }
  return out;
}

/**
 * Spec stage 1: "ask one clarifying question per ambiguous term … maximum 5 questions per round",
 * in code. An abbreviation with no expansion anywhere in the inputs is ambiguous; so is a
 * one-word term the profile could not type (it fell to the first type). Nothing else is asked:
 * the objectives are the student's own words.
 */
export type IntakeQuestion = {
  id: string;
  entityId: string | null;
  kind: 'abbreviation' | 'meaning' | 'scope';
  question: string;
};

export function intakeQuestions(
  entities: readonly BuildEntity[],
  input: { objectives: readonly string[]; fallbackType: string },
): IntakeQuestion[] {
  const out: IntakeQuestion[] = [];
  for (const entity of entities) {
    if (out.length >= 5) break;
    const abbreviation = /^[A-Z][A-Z0-9]{1,7}$/.test(entity.text);
    const expanded = entity.aliases.some((a) => a.length > entity.text.length + 2);
    if (abbreviation && !expanded) {
      out.push({
        id: `q${out.length + 1}`,
        entityId: entity.id,
        kind: 'abbreviation',
        question: `What does “${entity.text}” stand for? (It will be defined at first use.)`,
      });
      continue;
    }
    if (entity.typeUnknown && !entity.text.includes(' ') && entity.text.length <= 12) {
      out.push({
        id: `q${out.length + 1}`,
        entityId: entity.id,
        kind: 'meaning',
        question: `“${entity.text}” did not fit any of this discipline’s kinds of key term. What is it, in a few words?`,
      });
    }
  }
  if (input.objectives.length === 0 && out.length < 5) {
    out.push({
      id: `q${out.length + 1}`,
      entityId: null,
      kind: 'scope',
      question:
        'No objectives are recorded on the proposal screen. In one or two sentences, what does this thesis set out to do?',
    });
  }
  return out;
}

/** A mock answer built from the inputs: capitalised phrases and quoted terms of the objectives. */
export function mockEntitiesFor(req: LlmRequest): EntitiesResult {
  const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
  const types = [...user.matchAll(/<type code="([^"]+)"/g)].map((m) => m[1] as string);
  const objectives = [...user.matchAll(/<objective n="(\d+)">([\s\S]*?)<\/objective>/g)];
  const entities: EntitiesResult['entities'] = [];
  for (const [, n, text] of objectives) {
    for (const match of (text ?? '').matchAll(
      /\b([A-Z][A-Za-z0-9]*(?:[ -][A-Z0-9][A-Za-z0-9]*){0,3}|[A-Z]{2,}\d*|[A-Za-z]+\d[A-Za-z0-9]*)\b/g,
    )) {
      const term = match[1] as string;
      if (term.length < 2 || /^(The|This|These|To|A|An|In|On|Of|And|For|With)$/.test(term))
        continue;
      entities.push({
        text: term,
        type: types[entities.length % Math.max(1, types.length)] ?? 'TERM',
        sourceObjective: Number(n),
        aliases: [],
      });
    }
  }
  return { entities: entities.slice(0, 12) };
}

// --------------------------------------------------------------------------------------------
// Examiner
// --------------------------------------------------------------------------------------------

export const EXAMINER_ISSUE_TYPES = [
  'inaccuracy',
  'contradiction',
  'unsupported',
  'different_subject',
  'definition',
  'entity_missing',
  'terminology',
  'pitfall',
  'summary',
  'tense',
  'discipline',
] as const;
export type ExaminerIssueType = (typeof EXAMINER_ISSUE_TYPES)[number];

export const examinerSchema = z.object({
  issues: z.array(
    z.object({
      sentenceId: z.string(),
      issueType: z.string(),
      explanation: z.string(),
      correction: z.string(),
      severity: z.string(),
      pitfallCode: z.string(),
    }),
  ),
});
export type ExaminerResult = z.infer<typeof examinerSchema>;

export type ExaminerSentence = { id: string; text: string };
export type ExaminerPitfall = { code: string; wrong: string; correct: string };
export type ExaminerPassage = { id: string; text: string };

export type ExaminerInput = {
  discipline: DisciplineProfile;
  paradigm: string;
  degree: string;
  section: { id: string; title: string; purpose: string; isSummary: boolean };
  sentences: readonly ExaminerSentence[];
  entities: ReadonlyArray<{ text: string; type: string }>;
  passages: readonly ExaminerPassage[];
  terminology: readonly TerminologyRule[];
  pitfalls: readonly ExaminerPitfall[];
  /** For a summary section: the other sections' titles and opening sentences (check S4). */
  chapterOutline?: ReadonlyArray<{ title: string; opening: string }>;
  userId: string;
  documentId: string;
};

/** The section as numbered sentences, headings and fragments left out. */
export function examinerSentences(markdown: string): ExaminerSentence[] {
  const out: ExaminerSentence[] = [];
  for (const block of markdown.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed || /^###\s/.test(trimmed) || /^\[\[NEEDS SOURCE:/i.test(trimmed)) continue;
    for (const sentence of splitSentences(trimmed)) {
      if (
        sentence.replace(/\{\{cite:[^}]+\}\}/g, '').trim().length < CHAPTER_BUILD.minSentenceChars
      ) {
        continue;
      }
      out.push({ id: `s${out.length + 1}`, text: sentence });
    }
  }
  return out;
}

export function buildExaminerRequest(input: ExaminerInput): Omit<LlmRequest, 'schema'> {
  const lines = [
    `<review discipline="${attr(input.discipline.displayName)}" paradigm="${attr(input.paradigm)}" degree="${attr(input.degree)}">`,
    `<section id="${attr(input.section.id)}" title="${attr(input.section.title)}" purpose="${attr(input.section.purpose)}">`,
    ...input.sentences.map((s) => `<s id="${s.id}">${cleanBuildText(s.text)}</s>`),
    '</section>',
    '<entities>',
    ...input.entities.map(
      (e) => `<entity type="${attr(e.type)}">${cleanBuildText(e.text)}</entity>`,
    ),
    '</entities>',
    '<passages>',
    ...input.passages
      .slice(0, CHAPTER_BUILD.maxPassages)
      .map((p) => `<passage id="${attr(p.id)}">${cleanBuildText(p.text)}</passage>`),
    '</passages>',
    '<terminology>',
    ...input.terminology.map(
      (t) =>
        `<term preferred="${attr(t.preferred)}">${t.avoid.map(cleanBuildText).join('; ')}</term>`,
    ),
    '</terminology>',
    '<pitfalls>',
    ...input.pitfalls.map(
      (p) =>
        `<pitfall code="${attr(p.code)}">wrong: ${cleanBuildText(p.wrong)}; correct: ${cleanBuildText(p.correct)}</pitfall>`,
    ),
    '</pitfalls>',
    '<focus>',
    ...input.discipline.examinerFocus.map((f) => `<item>${cleanBuildText(f)}</item>`),
    '</focus>',
  ];
  if (input.section.isSummary && input.chapterOutline) {
    lines.push('<chapter>');
    for (const s of input.chapterOutline) {
      lines.push(`<section title="${attr(s.title)}">${cleanBuildText(s.opening)}</section>`);
    }
    lines.push('</chapter>');
  }
  lines.push('</review>');
  return {
    tier: CHAPTER_BUILD.examiner.tier,
    system: system('examiner'),
    messages: [{ role: 'user', content: lines.join('\n') }],
    maxTokens: CHAPTER_BUILD.examiner.maxTokens,
    temperature: CHAPTER_BUILD.examiner.temperature,
    action: 'CHAPTER_BUILD',
    userId: input.userId,
    documentId: input.documentId,
  };
}

export type ExaminerIssue = {
  sentenceId: string;
  sentence: string;
  issueType: ExaminerIssueType;
  checkId: CheckId;
  explanation: string;
  correction: string;
  severity: 'blocking' | 'warning';
  pitfallCode?: string;
};

/** Which check of the catalogue an examiner issue is counted under. */
export function examinerIssueCheck(type: ExaminerIssueType, disciplineId: string): CheckId {
  switch (type) {
    case 'inaccuracy':
      return 'T4';
    case 'contradiction':
      return 'T1';
    case 'unsupported':
      return 'E4';
    case 'different_subject':
      return 'E5';
    case 'definition':
      return 'T3';
    case 'entity_missing':
      return 'S1';
    case 'terminology':
      return 'L4';
    case 'pitfall':
      return 'T2';
    case 'summary':
      return 'S4';
    case 'tense':
      return 'L5';
    case 'discipline':
      if (disciplineId.startsWith('medicine') || disciplineId.startsWith('pharmacy'))
        return 'D-MED2';
      if (disciplineId.startsWith('management') || disciplineId.startsWith('social'))
        return 'D-MGT2';
      if (disciplineId.startsWith('law')) return 'D-LAW1';
      return 'T4';
    default:
      return 'T4';
  }
}

export function postProcessExaminer(
  result: ExaminerResult,
  input: Pick<ExaminerInput, 'sentences' | 'pitfalls' | 'discipline'>,
): { issues: ExaminerIssue[]; dropped: number } {
  const byId = new Map(input.sentences.map((s) => [s.id, s.text]));
  const codes = new Set(input.pitfalls.map((p) => p.code));
  const seen = new Set<string>();
  const issues: ExaminerIssue[] = [];
  let dropped = 0;
  for (const raw of result.issues) {
    const sentence = byId.get(raw.sentenceId.trim());
    if (!sentence) {
      dropped++;
      continue;
    }
    const issueType = (EXAMINER_ISSUE_TYPES as readonly string[]).includes(raw.issueType)
      ? (raw.issueType as ExaminerIssueType)
      : 'discipline';
    const key = `${raw.sentenceId}|${issueType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pitfallCode = codes.has(raw.pitfallCode.trim()) ? raw.pitfallCode.trim() : undefined;
    issues.push({
      sentenceId: raw.sentenceId.trim(),
      sentence,
      issueType,
      checkId: examinerIssueCheck(issueType, input.discipline.id),
      explanation: raw.explanation.trim().slice(0, 600),
      correction: raw.correction.trim().slice(0, 400),
      severity: raw.severity.trim().toLowerCase() === 'warning' ? 'warning' : 'blocking',
      ...(pitfallCode ? { pitfallCode } : {}),
    });
    if (issues.length >= CHAPTER_BUILD.maxIssuesPerSection) break;
  }
  return { issues, dropped };
}

/** The mock examiner: reports nothing, except a sentence that matches a pitfall in its request. */
export function mockExaminerFor(req: LlmRequest): ExaminerResult {
  const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
  const sentences = [...user.matchAll(/<s id="(s\d+)">([\s\S]*?)<\/s>/g)];
  const pitfalls = [
    ...user.matchAll(/<pitfall code="([^"]+)">wrong: ([\s\S]*?); correct: ([\s\S]*?)<\/pitfall>/g),
  ];
  const issues: ExaminerResult['issues'] = [];
  for (const [, id, text] of sentences) {
    for (const [, code, wrong, correct] of pitfalls) {
      const key = (wrong ?? '').toLowerCase().split(/\s+/).slice(0, 3).join(' ');
      if (key && (text ?? '').toLowerCase().includes(key)) {
        issues.push({
          sentenceId: id as string,
          issueType: 'pitfall',
          explanation: `Matches pitfall ${code}.`,
          correction: (correct ?? '').trim(),
          severity: 'blocking',
          pitfallCode: code as string,
        });
      }
    }
  }
  return { issues };
}

// --------------------------------------------------------------------------------------------
// Fix the flagged sentences
// --------------------------------------------------------------------------------------------

export type FixInput = {
  section: { title: string; markdown: string };
  issues: ReadonlyArray<{ sentence: string; explanation: string; correction: string }>;
  passages: readonly ExaminerPassage[];
  userId: string;
  documentId: string;
};

export function buildFixRequest(input: FixInput): LlmRequest {
  const user = [
    '<fix>',
    `<section title="${attr(input.section.title)}">`,
    cleanBuildText(input.section.markdown),
    '</section>',
    '<issues>',
    ...input.issues.map(
      (i) =>
        `<issue sentence="${attr(i.sentence)}">${cleanBuildText(i.explanation)}${i.correction ? ` — ${cleanBuildText(i.correction)}` : ''}</issue>`,
    ),
    '</issues>',
    '<passages>',
    ...input.passages.map((p) => `<passage id="${attr(p.id)}">${cleanBuildText(p.text)}</passage>`),
    '</passages>',
    '</fix>',
  ].join('\n');
  return {
    tier: CHAPTER_BUILD.fix.tier,
    system: system('fix_flagged'),
    messages: [{ role: 'user', content: user }],
    maxTokens: CHAPTER_BUILD.fix.maxTokens,
    temperature: CHAPTER_BUILD.fix.temperature,
    action: 'CHAPTER_BUILD',
    userId: input.userId,
    documentId: input.documentId,
  };
}

const sentenceKey = (s: string): string =>
  s
    .replace(/\{\{cite:[^}]+\}\}/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * The guard behind "keep all other text identical": the share of sentences the fixer was not
 * asked to change that are still present in its output. Below `keepRatio` the fix is rejected.
 */
export function unchangedSentencesKept(
  original: string,
  fixed: string,
  flagged: readonly string[],
): { kept: number; expected: number; ratio: number } {
  const flaggedKeys = new Set(flagged.map(sentenceKey));
  const expected = splitSentences(original.replace(/^###.*$/gm, ''))
    .map(sentenceKey)
    .filter((k) => k.length > 0 && !flaggedKeys.has(k));
  const present = new Set(splitSentences(fixed.replace(/^###.*$/gm, '')).map(sentenceKey));
  const kept = expected.filter((k) => present.has(k)).length;
  return {
    kept,
    expected: expected.length,
    ratio: expected.length === 0 ? 1 : kept / expected.length,
  };
}

/** The mock fixer: replaces each flagged sentence with its correction, or drops it. */
export function mockFixFor(req: LlmRequest): string {
  const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
  const section = /<section title="[^"]*">([\s\S]*?)<\/section>/.exec(user)?.[1] ?? '';
  let text = section.trim();
  for (const match of user.matchAll(/<issue sentence="([^"]*)">([\s\S]*?)<\/issue>/g)) {
    const sentence = (match[1] ?? '').replace(/”/g, '"');
    const correction = (match[2] ?? '').split(' — ')[1]?.trim();
    if (sentence && text.includes(sentence)) {
      text = text.replace(sentence, correction ? `${correction}` : '').replace(/ {2,}/g, ' ');
    }
  }
  return text;
}
