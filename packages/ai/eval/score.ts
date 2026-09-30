/**
 * Scored prompt evaluation (ADR-0038, 2026-09-30): the tasks whose right answer is known in
 * advance, so no judge is needed.
 *
 *   pnpm --filter @tc/ai exec dotenv -e ../../.env -- tsx eval/score.ts <task> [--samples N]
 *
 * task: proofread | cite | coh_support | coh_unsupported | coh_claim | coh_term
 *
 * Every case is built from the real abstracts in `eval/papers/`, changed in a known way:
 * - a sentence as the paper wrote it (supported by that paper);
 * - the same sentence with its figure changed (the paper does not say that);
 * - a sentence from another field's paper (nothing here supports it);
 * - for proofreading, a clean sentence with one error put in, of a known kind.
 * The term-drift cases are the one exception: a term, its definition and five sentences written
 * for the test, two of which misuse it (`TERM_CASES`). They make no claim about any paper.
 *
 * Both versions of the prompt see the same cases through production's own request builders and
 * post-processing; the score is counted in code.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@tc/config';
import type { z } from 'zod';
import type { PromptPassage } from '../src/builder/assist.js';
import { buildCiteRequest, citeResultSchema, usableCandidates } from '../src/builder/cite.js';
import { buildCiteParseRequest, parsedCitationSchema } from '../src/builder/cite-parse.js';
import { buildCiteRoleRequest, postProcessCiteRole } from '../src/builder/cite-role.js';
import {
  buildContradictionRequest,
  buildOutlineDriftRequest,
  buildSupportRequest,
  buildTermDriftRequest,
  buildUnsupportedRequest,
  contradictionSchema,
  outlineDriftSchema,
  SUPPORT_VERDICTS,
  supportSchema,
  termDriftSchema,
  unsupportedSchema,
} from '../src/builder/coherence.js';
import { commandResultSchema } from '../src/builder/command.js';
import {
  buildProofreadRequest,
  postProcessProofread,
  proofreadSchema,
} from '../src/builder/proofread.js';
import { splitSentences } from '../src/builder/quality.js';
import {
  buildVivaFeedbackRequest,
  postProcessVivaFeedback,
  vivaFeedbackSchema,
} from '../src/builder/viva.js';
import { createProviders } from '../src/factory.js';
import { overridePrompt, type PromptName } from '../src/prompts.js';
import type { LlmProvider, LlmRequest, Tier } from '../src/types.js';
import { metered } from './meter.js';
import {
  citedSentences,
  draftedSection,
  memoryFor,
  type Paper,
  papersFor,
  passagesFor,
} from './shared.js';
import { TOPICS, type Topic } from './topics.js';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------------------------
// Sentences from the real abstracts
// ---------------------------------------------------------------------------------------------

/** Abstract section labels ("BACKGROUND:", "Design/methodology/approach") are not part of a claim. */
const LABEL =
  /^(?:abstract|background|purpose|objectives?|aims?|methods?|results?|findings|conclusions?|design\/methodology\/approach|originality\/value)\s*:?\s+/i;

function claimSentences(text: string): string[] {
  return splitSentences(text)
    .map((s) => s.replace(LABEL, '').replace(LABEL, ''))
    .filter((s) => {
      const words = s.split(/\s+/).length;
      return words >= 12 && words <= 40 && /^[A-Z]/.test(s) && !/©|copyright|elsevier/i.test(s);
    });
}

/**
 * A figure that is a finding or a study detail: a number followed by a unit or a counted noun
 * ("49 members", "500 μs", "12%"), not part of a name ("18Ni-300", "grade 300") and not a year.
 */
const FIGURE = /(?<![\w-])(\d+(?:\.\d+)?)(?=\s?(?:%|[a-zμ°]))/g;

/** The sentence with its first figure changed; null if it has none. */
function alterFigure(sentence: string): string | null {
  for (const match of sentence.matchAll(FIGURE)) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value >= 1900 && value <= 2100) continue;
    if (value === 0) continue;
    const at = match.index ?? 0;
    if (/grade\s$/i.test(sentence.slice(0, at))) continue;
    const changed = Number.isInteger(value) ? String(value * 3 + 7) : (value * 3).toFixed(2);
    return sentence.slice(0, at) + changed + sentence.slice(at + (match[1] as string).length);
  }
  return null;
}

type SourcedSentence = { passageId: string; sentence: string; altered: string | null };

/** For each of the first `count` passages, its first usable sentence (preferring one with a figure). */
function sourcedSentences(topic: Topic, count: number): SourcedSentence[] {
  return passagesFor(topic, count).flatMap((p) => {
    const sentences = claimSentences(p.text);
    const withFigure = sentences.find((s) => alterFigure(s) !== null);
    const sentence = withFigure ?? sentences[0];
    return sentence
      ? [{ passageId: p.id, sentence, altered: withFigure ? alterFigure(withFigure) : null }]
      : [];
  });
}

function otherTopic(topic: Topic): Topic {
  const i = TOPICS.indexOf(topic);
  return TOPICS[(i + 1) % TOPICS.length] as Topic;
}

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// ---------------------------------------------------------------------------------------------
// Proofreading: one known error per sentence
// ---------------------------------------------------------------------------------------------

type Injected = { kind: string; bad: string };

const INJECTORS: Array<(s: string) => Injected | null> = [
  (s) => {
    const m = /\b([a-z]{8,})\b/.exec(s);
    if (!m) return null;
    const w = m[1] as string;
    const typo = w.slice(0, 3) + w[4] + w[3] + w.slice(5);
    return { kind: 'spelling', bad: s.slice(0, m.index) + typo + s.slice(m.index + w.length) };
  },
  (s) => {
    const m = /\b(the|of|and)\b/.exec(s);
    if (!m) return null;
    const w = m[1] as string;
    return { kind: 'doubled', bad: `${s.slice(0, m.index)}${w} ${s.slice(m.index)}` };
  },
  (s) => {
    for (const [from, to] of [
      [' is ', ' are '],
      [' was ', ' were '],
      [' has ', ' have '],
      [' are ', ' is '],
      [' were ', ' was '],
    ] as const) {
      if (s.includes(from)) return { kind: 'agreement', bad: s.replace(from, to) };
    }
    return null;
  },
  (s) => {
    const m = / an ([aeiou])/i.exec(s);
    if (m) return { kind: 'article', bad: s.replace(m[0], ` a ${m[1]}`) };
    const n = / a ([bcdfgjklmnpqrstvwz])/.exec(s);
    if (n) return { kind: 'article', bad: s.replace(n[0], ` an ${n[1]}`) };
    return null;
  },
  (s) => {
    for (const [from, to] of [
      [' shown ', ' showed '],
      [' increased ', ' increase '],
      [' improved ', ' improve '],
      [' reduced ', ' reduce '],
      [' used ', ' use '],
    ] as const) {
      if (s.includes(from)) return { kind: 'verb form', bad: s.replace(from, to) };
    }
    return null;
  },
];

type ProofCase = { id: string; clean: string; text: string; kind: string | null };

function proofreadCases(topic: Topic): ProofCase[] {
  const sentences = passagesFor(topic, 8).flatMap((p) => claimSentences(p.text).slice(0, 2));
  const out: ProofCase[] = [];
  let injector = TOPICS.indexOf(topic);
  sentences.slice(0, 12).forEach((clean, i) => {
    const id = `${topic.id.slice(0, 3)}${i + 1}`;
    if (i % 2 === 0) {
      // Try the injectors in turn, starting from a different one per sentence.
      for (let t = 0; t < INJECTORS.length; t++) {
        const inj = (
          INJECTORS[(injector + t) % INJECTORS.length] as (s: string) => Injected | null
        )(clean);
        if (inj && inj.bad !== clean) {
          out.push({ id, clean, text: inj.bad, kind: inj.kind });
          injector++;
          return;
        }
      }
    }
    out.push({ id, clean, text: clean, kind: null });
  });
  return out;
}

function applyCorrections(
  text: string,
  corrections: ReadonlyArray<{ original: string; replacement: string }>,
): string {
  let out = text;
  for (const c of corrections) out = out.replace(c.original, c.replacement);
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------
// Term drift: written for the test (see the header)
// ---------------------------------------------------------------------------------------------

type TermCase = {
  topic: string;
  term: string;
  definition: string;
  ok: string[];
  conflict: string;
  drift: string;
};

const TERM_CASES: TermCase[] = [
  {
    topic: 'edm-hastelloy',
    term: 'tool wear rate',
    definition: 'The volume of electrode material lost per minute of machining, in mm³/min.',
    ok: [
      'Graphite electrodes showed a lower tool wear rate than copper electrodes at the same peak current.',
      'Tool wear rate rose with pulse-on time for every electrode material tested.',
      'Because tool wear rate is expressed per minute, it must be read alongside machining time.',
    ],
    conflict:
      'Tool wear rate, the volume of workpiece material removed per minute, rose sharply with peak current.',
    drift:
      'In this thesis tool wear rate also covers the loss of dimensional accuracy in the machined cavity.',
  },
  {
    topic: 'slm-maraging',
    term: 'reversed austenite',
    definition:
      'Austenite that forms from martensite during ageing or intercritical heat treatment, as distinct from austenite retained from solidification.',
    ok: [
      'Ageing at higher temperatures increased the fraction of reversed austenite.',
      'Reversed austenite formed along the martensite lath boundaries during intercritical treatment.',
      'The as-built parts contained retained austenite but no reversed austenite.',
    ],
    conflict:
      'Reversed austenite is the austenite retained in the as-built part from rapid solidification.',
    drift:
      'Any phase that is not martensite is counted here as reversed austenite, including precipitates.',
  },
  {
    topic: 'rooftop-solar-india',
    term: 'adoption',
    definition: 'A household installing a rooftop solar system on its own dwelling.',
    ok: [
      'Adoption was lower among households that rented their homes.',
      'Upfront cost remained the most cited reason for delaying adoption.',
      'Villages with a local installer showed faster adoption.',
    ],
    conflict: 'Adoption here means that a household has heard of the subsidy scheme.',
    drift: 'Adoption also includes households that buy power from a community solar farm.',
  },
  {
    topic: 'mhealth-diabetes',
    term: 'engagement',
    definition: 'The number of days on which a participant logged at least one entry in the app.',
    ok: [
      'Engagement fell by half between the first and the twelfth week.',
      'Participants who received reminders showed higher engagement.',
      'Engagement was counted from the app logs rather than from self-report.',
    ],
    conflict: "Engagement was measured by participants' satisfaction scores at twelve weeks.",
    drift:
      'Engagement also counts the days on which the app was opened without any entry being made.',
  },
  {
    topic: 'microfinance-women',
    term: "women's empowerment",
    definition:
      "A woman's control over household decisions on spending, borrowing and her own mobility.",
    ok: [
      "Women's empowerment was higher among members who controlled their own loan use.",
      "Group membership was associated with greater women's empowerment in mobility decisions.",
      "Women's empowerment did not rise where husbands took over the loan.",
    ],
    conflict: "Women's empowerment was measured as the size of the loan a woman received.",
    drift: "Women's empowerment here also includes the growth of her business's revenue.",
  },
];

/** Signposting sentences a student writes in a review; they make no claim needing a citation. */
const STRUCTURE = [
  'This chapter reviews the studies most relevant to the research questions set out in Chapter 1.',
  'The next section turns from these findings to the methods used to obtain them.',
];

// ---------------------------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------------------------

type Tally = Record<string, number>;
type Task = {
  prompt: PromptName;
  /** Measures, and which direction is better. */
  measures: Record<string, 'higher' | 'lower'>;
  run: (llm: LlmProvider, tally: Tally, log: string[]) => Promise<void>;
};

const add = (t: Tally, k: string, n = 1) => {
  t[k] = (t[k] ?? 0) + n;
};

const TASKS: Record<string, Task> = {
  proofread: {
    prompt: 'proofread',
    measures: {
      errorsFixed: 'higher',
      cleanSentencesChanged: 'lower',
      extraChangesInErrorSentences: 'lower',
    },
    async run(llm, t, log) {
      for (const topic of TOPICS) {
        const cases = proofreadCases(topic);
        const sentences = cases.map((c) => ({ id: c.id, text: c.text }));
        const req = buildProofreadRequest({ sentences, userId: 'eval', documentId: 'eval' });
        const result = await llm.complete({ ...req, schema: proofreadSchema });
        const { corrections } = postProcessProofread(result.value, sentences);
        for (const c of cases) {
          const mine = corrections.filter((x) => x.sentenceId === c.id);
          const fixed = norm(applyCorrections(c.text, mine));
          if (c.kind) {
            add(t, 'errors');
            if (fixed === norm(c.clean)) add(t, 'errorsFixed');
            else {
              if (fixed !== norm(c.text)) add(t, 'extraChangesInErrorSentences');
              log.push(`missed ${c.kind}: ${c.text.slice(0, 90)}`);
            }
          } else {
            add(t, 'clean');
            if (fixed !== norm(c.clean)) {
              add(t, 'cleanSentencesChanged');
              log.push(
                `changed clean: ${mine.map((m) => `${m.original} -> ${m.replacement}`).join('; ')}`,
              );
            }
          }
        }
      }
    },
  },

  cite: {
    prompt: 'cite',
    measures: {
      trueSourceOffered: 'higher',
      changedFigureOfferedAsDirect: 'lower',
      offTopicOffered: 'lower',
    },
    async run(llm, t, log) {
      for (const topic of TOPICS) {
        const passages = passagesFor(topic, 6);
        const ids = passages.map((p) => p.id);
        const memoryBlock = memoryFor(topic, '');
        const ask = async (sentence: string) => {
          const req = buildCiteRequest({
            memoryBlock,
            sentence,
            passages,
            userId: 'eval',
            documentId: 'eval',
          });
          const result = await llm.complete({ ...req, schema: citeResultSchema });
          return usableCandidates(result.value, ids, { sentence, passages }).candidates;
        };
        for (const s of sourcedSentences(topic, 3)) {
          add(t, 'supported');
          const shown = await ask(s.sentence);
          if (shown.some((c) => c.id === s.passageId)) add(t, 'trueSourceOffered');
          else log.push(`missed source: ${s.sentence.slice(0, 80)}`);
          if (s.altered) {
            add(t, 'changedFigure');
            const alt = await ask(s.altered);
            if (alt.some((c) => c.id === s.passageId && c.support === 'direct')) {
              add(t, 'changedFigureOfferedAsDirect');
              log.push(`changed figure called direct: ${s.altered.slice(0, 80)}`);
            }
          }
        }
        for (const s of sourcedSentences(otherTopic(topic), 2)) {
          add(t, 'offTopic');
          const shown = await ask(s.sentence);
          if (shown.length > 0) {
            add(t, 'offTopicOffered');
            log.push(
              `off-topic offered ${shown.map((c) => c.support).join(',')}: ${s.sentence.slice(0, 80)}`,
            );
          }
        }
      }
    },
  },

  coh_support: {
    prompt: 'coh_support',
    measures: { rightVerdict: 'higher', wrongSupported: 'lower' },
    async run(llm, t, log) {
      for (const topic of TOPICS) {
        const passages = passagesFor(topic, 6);
        const byId = new Map(passages.map((p) => [p.id, p]));
        const items: Array<{
          sentenceId: string;
          sentence: string;
          passages: PromptPassage[];
          expect: readonly string[];
        }> = [];
        for (const [i, s] of sourcedSentences(topic, 3).entries()) {
          const cited = [byId.get(s.passageId) as PromptPassage];
          items.push({
            sentenceId: `v${i}`,
            sentence: `Earlier work reported that ${lcFirst(s.sentence)}`,
            passages: cited,
            expect: ['SUPPORTED'],
          });
          if (s.altered) {
            items.push({
              sentenceId: `a${i}`,
              sentence: `Earlier work reported that ${lcFirst(s.altered)}`,
              passages: cited,
              expect: ['MISREPRESENTED', 'OVERSTATED'],
            });
          }
        }
        for (const [i, s] of sourcedSentences(otherTopic(topic), 2).entries()) {
          items.push({
            sentenceId: `o${i}`,
            sentence: s.sentence,
            passages: [passages[i] as PromptPassage],
            expect: ['NOT_IN_PASSAGE', 'DIFFERENT_SUBJECT'],
          });
        }
        const req = buildSupportRequest({ items, userId: 'eval', documentId: 'eval' });
        const result = await llm.complete({ ...req, schema: supportSchema });
        for (const item of items) {
          add(t, 'items');
          const verdict =
            result.value.results.find((r) => r.sentenceId === item.sentenceId)?.verdict ??
            'MISSING';
          if (item.expect.includes(verdict)) add(t, 'rightVerdict');
          else
            log.push(
              `${item.sentenceId} expected ${item.expect.join('/')} got ${verdict}: ${item.sentence.slice(0, 70)}`,
            );
          if (verdict === 'SUPPORTED' && !item.expect.includes('SUPPORTED'))
            add(t, 'wrongSupported');
        }
      }
      void SUPPORT_VERDICTS;
    },
  },

  coh_unsupported: {
    prompt: 'coh_unsupported',
    measures: { rightCall: 'higher', structureFlagged: 'lower' },
    async run(llm, t, log) {
      for (const topic of TOPICS) {
        const claims = sourcedSentences(topic, 4).map((s, i) => ({
          id: `c${i}`,
          text: s.sentence,
          needs: true,
        }));
        const structure = STRUCTURE.map((text, i) => ({ id: `s${i}`, text, needs: false }));
        const all = [...claims, ...structure];
        const req = buildUnsupportedRequest({
          sentences: all.map(({ id, text }) => ({ id, text })),
          chapterRole: 'Literature Review',
          userId: 'eval',
          documentId: 'eval',
        });
        const result = await llm.complete({ ...req, schema: unsupportedSchema });
        for (const s of all) {
          add(t, 'sentences');
          const call = result.value.results.find((r) => r.sentenceId === s.id)?.needsSupport;
          if (call === s.needs) add(t, 'rightCall');
          else log.push(`${s.id} expected ${s.needs} got ${call}: ${s.text.slice(0, 70)}`);
          if (!s.needs && call === true) add(t, 'structureFlagged');
        }
      }
    },
  },

  coh_claim: {
    prompt: 'coh_claim',
    measures: { contradictionCaught: 'higher', consistentFlagged: 'lower' },
    async run(llm, t, log) {
      for (const topic of TOPICS) {
        const sourced = sourcedSentences(topic, 6).filter((s) => s.altered);
        const claims = sourced.slice(0, 4).map((s, i) => ({
          id: `k${i}`,
          text: s.sentence,
          contradicted: i % 2 === 1,
          passages: [
            {
              id: `p${i}`,
              chapter: 'Chapter 4',
              text: `As reported in Chapter 2, ${lcFirst(i % 2 === 1 ? (s.altered as string) : s.sentence)}`,
            },
          ],
        }));
        const req = buildContradictionRequest({ claims, userId: 'eval', documentId: 'eval' });
        const result = await llm.complete({ ...req, schema: contradictionSchema });
        for (const c of claims) {
          const flagged = result.value.flags.some((f) => f.claimId === c.id);
          if (c.contradicted) {
            add(t, 'contradictions');
            if (flagged) add(t, 'contradictionCaught');
            else log.push(`missed: ${c.passages[0]?.text.slice(0, 80)}`);
          } else {
            add(t, 'consistent');
            if (flagged) {
              add(t, 'consistentFlagged');
              log.push(`false flag: ${c.text.slice(0, 80)}`);
            }
          }
        }
      }
    },
  },

  coh_term: {
    prompt: 'coh_term',
    measures: { misuseCaught: 'higher', correctUseFlagged: 'lower' },
    async run(llm, t, log) {
      for (const c of TERM_CASES) {
        const sentences = [
          ...c.ok.map((s, i) => ({ id: `ok${i}`, chapter: 'Chapter 2', sentence: s })),
          { id: 'conflict', chapter: 'Chapter 3', sentence: c.conflict },
          { id: 'drift', chapter: 'Chapter 4', sentence: c.drift },
        ];
        const req = buildTermDriftRequest({
          term: c.term,
          definition: c.definition,
          sentences,
          userId: 'eval',
          documentId: 'eval',
        });
        const result = await llm.complete({ ...req, schema: termDriftSchema });
        for (const s of sentences) {
          const flagged = result.value.flags.some((f) => f.sentenceId === s.id);
          if (s.id.startsWith('ok')) {
            add(t, 'correctUses');
            if (flagged) {
              add(t, 'correctUseFlagged');
              log.push(`false flag (${c.term}): ${s.sentence}`);
            }
          } else {
            add(t, 'misuses');
            if (flagged) add(t, 'misuseCaught');
            else log.push(`missed ${s.id} (${c.term})`);
          }
        }
      }
    },
  },

  cite_parse: {
    prompt: 'cite_parse',
    measures: { fieldsRight: 'higher', doiInvented: 'lower' },
    async run(llm, t, log) {
      for (const topic of TOPICS) {
        for (const [i, paper] of papersFor(topic).entries()) {
          const reference = referenceString(paper, i);
          const req = buildCiteParseRequest({ reference, userId: 'eval' });
          const { value } = await llm.complete({ ...req, schema: parsedCitationSchema });
          const family = lastName(paper.authors[0] ?? '');
          const checks: Array<[string, boolean]> = [
            ['title', same(value.title, paper.title)],
            ['year', value.year === paper.year],
            ['first author', family !== '' && same(value.authors[0]?.family ?? '', family)],
          ];
          if (paper.doi)
            checks.push(['doi', value.doi.toLowerCase().includes(paper.doi.toLowerCase())]);
          if (paper.venue) checks.push(['container', same(value.container, paper.venue)]);
          for (const [field, ok] of checks) {
            add(t, 'fields');
            if (ok) add(t, 'fieldsRight');
            else
              log.push(
                `${field} wrong (${i % 3 === 0 ? 'APA' : i % 3 === 1 ? 'IEEE' : 'Vancouver'}): ${reference.slice(0, 70)}`,
              );
          }
          if (!paper.doi && value.doi.trim() !== '') add(t, 'doiInvented');
        }
      }
    },
  },

  cite_role: {
    prompt: 'cite_role',
    measures: { rightForm: 'higher', claimChanged: 'lower', namesTyped: 'lower', refused: 'lower' },
    async run(llm, t, log) {
      for (const [i, c] of citedSentences().entries()) {
        const topic = TOPICS.find((x) => x.id === c.topic) as Topic;
        const citationId = /\{\{cite:([^}]+)\}\}/.exec(c.sentence)?.[1] as string;
        // Most are asked for the narrative form; every fourth for the form it already has.
        const targetRole = i % 4 === 3 ? 'parenthetical' : 'narrative';
        const req = buildCiteRoleRequest({
          sentence: c.sentence,
          citationId,
          targetRole,
          memoryBlock: memoryFor(topic, ''),
          userId: 'eval',
          documentId: 'eval',
        });
        const { value } = await llm.complete({ ...req, schema: commandResultSchema });
        const out = postProcessCiteRole(value.text, c.sentence, citationId);
        add(t, 'sentences');
        if (!out.ok) {
          add(t, 'refused');
          log.push(`refused: ${out.refusal}`);
          continue;
        }
        const s = out.sentence;
        const marker = `{{cite:${citationId}}}`;
        const opening = s.slice(0, s.indexOf(marker)).split(/\s+/).filter(Boolean).length;
        const right = targetRole === 'narrative' ? opening <= 4 : norm(s) === norm(c.sentence);
        if (right) add(t, 'rightForm');
        else log.push(`${targetRole} not achieved: ${s.slice(0, 100)}`);
        if (contentOverlap(c.sentence, s) < 0.75) {
          add(t, 'claimChanged');
          log.push(`claim changed: ${s.slice(0, 100)}`);
        }
        if (
          /\bet al\b|\b(19|20)\d{2}\b/.test(s.replace(/\{\{cite:[^}]+\}\}/g, '')) &&
          !/\bet al\b|\b(19|20)\d{2}\b/.test(c.sentence)
        ) {
          add(t, 'namesTyped');
          log.push(`name or year typed: ${s.slice(0, 100)}`);
        }
      }
    },
  },

  viva_feedback: {
    prompt: 'viva_feedback',
    measures: { rightVerdict: 'higher', weakAnswerPassed: 'lower' },
    async run(llm, t, log) {
      for (const topic of TOPICS) {
        const section = draftedSection(topic).shown;
        const passages = [{ id: 'p1', chapterTitle: topic.chapter.title, text: section }];
        const lead = splitSentences(section)
          .slice(0, 2)
          .join(' ')
          .replace(/\s*\([^)]*\d{4}[^)]*\)/g, '');
        const question = `Your review of ${topic.section.title.toLowerCase()} draws on several studies. What does that evidence establish, and how firm is it?`;
        const answers: Array<{ kind: string; text: string; expect: readonly string[] }> = [
          {
            kind: 'accurate',
            text: `${lead} The evidence comes from a small number of studies in specific settings, so I treat it as indicative rather than settled.`,
            expect: ['strong', 'partial'],
          },
          {
            kind: 'vague',
            text: 'There are many studies on this and they all show different things. It is a complex area and more research is needed.',
            expect: ['weak'],
          },
        ];
        const wrong = alterFigure(lead);
        if (wrong) {
          answers.push({
            kind: 'wrong figure',
            text: `${wrong} The evidence comes from a small number of studies, so I treat it as indicative.`,
            expect: ['weak', 'partial'],
          });
        }
        for (const a of answers) {
          const req = buildVivaFeedbackRequest({
            question,
            probing: 'Whether the student can state the key findings and their limits.',
            passages,
            answer: a.text,
            userId: 'eval',
            documentId: 'eval',
          });
          const { value } = await llm.complete({ ...req, schema: vivaFeedbackSchema });
          const verdict = postProcessVivaFeedback(value, passages).verdict;
          add(t, 'answers');
          if (a.expect.includes(verdict)) add(t, 'rightVerdict');
          else log.push(`${a.kind} answer called ${verdict} (${topic.id})`);
          if (a.kind !== 'accurate' && verdict === 'strong') add(t, 'weakAnswerPassed');
        }
      }
    },
  },

  coh_outline: {
    prompt: 'coh_outline',
    measures: { mismatchCaught: 'higher', itemsFlaggedOnMatch: 'lower' },
    async run(llm, t, log) {
      for (const topic of TOPICS) {
        const summary = draftedSection(topic).shown.split(/\s+/).slice(0, 220).join(' ');
        for (const [kind, scopeNote] of [
          ['match', topic.section.scopeNote],
          ['mismatch', otherTopic(topic).section.scopeNote],
        ] as const) {
          const req = buildOutlineDriftRequest({
            scopeNote,
            summary,
            userId: 'eval',
            documentId: 'eval',
          });
          const { value } = await llm.complete({ ...req, schema: outlineDriftSchema });
          if (kind === 'mismatch') {
            add(t, 'mismatches');
            if (value.missing.length > 0) add(t, 'mismatchCaught');
            else log.push(`mismatch not caught (${topic.id})`);
          } else {
            add(t, 'matches');
            const items = value.missing.length + value.extra.length;
            add(t, 'itemsFlaggedOnMatch', items);
            if (items > 1)
              log.push(
                `match flagged ${items}: ${[...value.missing, ...value.extra].join(' | ').slice(0, 120)}`,
              );
          }
        }
      }
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Round 3 helpers
// ---------------------------------------------------------------------------------------------

const lastName = (name: string) => name.trim().split(/\s+/).pop() ?? '';
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, -1)
    .map((w) => `${w[0]}.`)
    .join(' ');
const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const same = (a: string, b: string) =>
  fold(a) !== '' && (fold(a) === fold(b) || fold(a).includes(fold(b)) || fold(b).includes(fold(a)));

/** The paper's real metadata written out as a reference, in APA, IEEE or Vancouver by turn. */
function referenceString(p: Paper, i: number): string {
  const doi = p.doi ? ` https://doi.org/${p.doi}` : '';
  const venue = p.venue ?? '';
  if (i % 3 === 0) {
    const names = p.authors.map((a) => `${lastName(a)}, ${initials(a)}`).join(', ');
    return `${names} (${p.year}). ${p.title}. ${venue}.${doi}`;
  }
  if (i % 3 === 1) {
    const names = p.authors.map((a) => `${initials(a)} ${lastName(a)}`);
    const list =
      names.length > 1 ? `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}` : (names[0] ?? '');
    return `[${i}] ${list}, "${p.title}," ${venue}, ${p.year}${p.doi ? `, doi: ${p.doi}` : ''}.`;
  }
  const names = p.authors
    .map((a) => `${lastName(a)} ${initials(a).replace(/[.\s]/g, '')}`)
    .join(', ');
  return `${names}. ${p.title}. ${venue}. ${p.year}.${p.doi ? ` doi:${p.doi}` : ''}`;
}

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'that',
  'in',
  'to',
  'with',
  'by',
  'as',
  'for',
  'on',
  'is',
  'are',
  'however',
  'found',
  'reported',
  'shows',
  'show',
]);
function contentOverlap(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      fold(s.replace(/\{\{cite:[^}]+\}\}/g, ''))
        .split(' ')
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
    );
  const x = words(a);
  const y = words(b);
  if (x.size === 0) return 1;
  return [...x].filter((w) => y.has(w)).length / x.size;
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const name = process.argv[2] ?? '';
  if (name === '--dry') {
    for (const topic of TOPICS) {
      console.log(`\n== ${topic.id}`);
      for (const c of proofreadCases(topic))
        if (c.kind) console.log(`  [${c.kind}] ${c.text.slice(0, 110)}`);
      for (const s of sourcedSentences(topic, 3))
        console.log(
          `  ${s.passageId}: ${s.sentence.slice(0, 80)}\n     altered: ${s.altered?.slice(0, 80)}`,
        );
    }
    return;
  }
  const task = TASKS[name];
  if (!task) throw new Error(`task must be one of ${Object.keys(TASKS).join(', ')}`);
  const samples = Number(process.argv[process.argv.indexOf('--samples') + 1] || 1) || 1;
  const candidatePath = join(here, 'candidates', `${task.prompt}.md`);
  if (!existsSync(candidatePath)) throw new Error(`No candidate at ${candidatePath}`);
  const candidate = readFileSync(candidatePath, 'utf8');
  const tierTest = process.argv.includes('--tier-test')
    ? (process.argv[process.argv.indexOf('--tier-test') + 1] as Tier)
    : undefined;

  const meter = metered(createProviders(loadEnv()).llm);
  const sides = { current: {} as Tally, candidate: {} as Tally };
  const logs = { current: [] as string[], candidate: [] as string[] };
  const failures = { current: 0, candidate: 0 };

  for (let s = 0; s < samples; s++) {
    for (const side of ['current', 'candidate'] as const) {
      // --tier-test <tier>: the candidate is the current prompt on another model tier.
      overridePrompt(task.prompt, side === 'candidate' && !tierTest ? candidate : null);
      try {
        const llm =
          side === 'candidate' && tierTest
            ? {
                ...meter.llm,
                modelIdFor: meter.llm.modelIdFor,
                stream: (req: LlmRequest) => meter.llm.stream({ ...req, tier: tierTest }),
                complete: <T>(req: LlmRequest & { schema: z.ZodType<T> }) =>
                  meter.llm.complete({ ...req, tier: tierTest }),
              }
            : meter.llm;
        await task.run(llm, sides[side], logs[side]);
      } catch (error) {
        failures[side]++;
        logs[side].push(`FAILED: ${(error as Error).message.slice(0, 200)}`);
      } finally {
        overridePrompt(task.prompt, null);
      }
      console.log(`sample ${s + 1} ${side}: ${JSON.stringify(sides[side])}`);
    }
  }

  const verdicts = Object.entries(task.measures).map(([k, better]) => {
    const a = sides.current[k] ?? 0;
    const b = sides.candidate[k] ?? 0;
    return {
      measure: k,
      better,
      current: a,
      candidate: b,
      candidateBetter: better === 'higher' ? b > a : b < a,
      candidateWorse: better === 'higher' ? b < a : b > a,
    };
  });
  const summary = {
    task: name,
    samples,
    totals: sides,
    verdicts,
    failedRuns: failures,
    // Adopt only if the candidate is better on something and worse on nothing.
    adopt:
      verdicts.some((v) => v.candidateBetter) &&
      !verdicts.some((v) => v.candidateWorse) &&
      failures.candidate <= failures.current,
    spentRupees: meter.rupees(),
  };
  console.log(JSON.stringify(summary, null, 2));
  mkdirSync(join(here, 'results'), { recursive: true });
  writeFileSync(
    join(
      here,
      'results',
      `${name}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`,
    ),
    `${JSON.stringify({ summary, logs }, null, 2)}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
