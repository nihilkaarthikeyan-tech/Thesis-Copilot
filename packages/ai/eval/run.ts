/**
 * Side-by-side prompt evaluation on the real models (ADR-0038, 2026-09-30).
 *
 *   pnpm --filter @tc/ai exec dotenv -e ../../.env -- tsx eval/run.ts assist [--samples 2]
 *
 * For every case, the request is built exactly as production builds it, once with the prompt on
 * disk (A) and once with `eval/candidates/<name>.md` (B). Both answers pass through production's
 * own post-processing (the citation whitelist and the quality filters), because that is what a
 * student would see. A stronger model then judges each pair blind, twice with the order swapped,
 * as a thesis examiner would: which is the better next part of this thesis, given these sources.
 * A preference counts only when both orders agree.
 *
 * Measured too, without a judge: how often each version answers at all, cites, cites something
 * not in the request (always 0 after the whitelist, but counted before it), and how much of its
 * text the quality filters had to remove.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '@tc/config';
import type { OutlineNode } from '@tc/types';
import { z } from 'zod';
import { buildAssistRequest, type PromptPassage } from '../src/builder/assist.js';
import { buildChatRequest, postProcessChat } from '../src/builder/chat.js';
import {
  buildCommandRequest,
  commandResultSchema,
  postProcessCommand,
} from '../src/builder/command.js';
import { buildReviseRequest, postProcessRevision } from '../src/builder/comment.js';
import {
  buildDeepChatRequest,
  buildResearchPlanRequest,
  cleanResearchPlan,
  researchPlanSchema,
} from '../src/builder/deep-research.js';
import { buildDraftRequest, postProcessDraft } from '../src/builder/draft.js';
import { buildMemoryBlock } from '../src/builder/memory.js';
import {
  buildOutlineRequest,
  dropPlaceholderSections,
  enforceTemplateShape,
  normaliseOutline,
  outlineRequestSchema,
  readOutlineResult,
} from '../src/builder/outline.js';
import { postProcessAssist } from '../src/builder/postprocess.js';
import {
  buildProposalRequest,
  type ProposalTurn,
  parseProposalReply,
  SKELETON_INSTRUCTION,
} from '../src/builder/proposal.js';
import { splitSentences } from '../src/builder/quality.js';
import { buildQueriesRequest, cleanQueries, queriesSchema } from '../src/builder/queries.js';
import { ownPlaces, placesIn, unmarkedOtherSettings } from '../src/builder/setting.js';
import { buildThemesRequest, normaliseThemes, themesSchema } from '../src/builder/themes.js';
import {
  buildVivaQuestionsRequest,
  postProcessVivaQuestions,
  vivaQuestionsSchema,
} from '../src/builder/viva.js';
import { createProviders } from '../src/factory.js';
import { overridePrompt, type PromptName } from '../src/prompts.js';
import type { LlmProvider, LlmRequest } from '../src/types.js';
import { type Measures, measure, totals } from './copying.js';
import { metered } from './meter.js';
import { draftedSection, memoryFor, papersFor, passagesFor, readable } from './shared.js';
import { BAGLA_P11, FRESH, KARNATAKA, TAMILNADU, TOPICS, type Topic } from './topics.js';

const here = dirname(fileURLToPath(import.meta.url));

async function streamText(
  llm: LlmProvider,
  request: LlmRequest,
): Promise<{ text: string; cost: number }> {
  let text = '';
  let tokens = { input: 0, output: 0 };
  for await (const chunk of llm.stream(request)) {
    if (chunk.type === 'text') text += chunk.text;
    else tokens = { input: chunk.usage.inputTokens, output: chunk.usage.outputTokens };
  }
  return { text, cost: tokens.input + tokens.output };
}

type Output = {
  text: string;
  shown: string;
  cited: number;
  empty: boolean;
  dropped: number;
  raw: string;
  /** Chat only (ADR-0074): measured in code, not by the judge. */
  chat?: ChatMeasures;
  /** ADR-0075: copying, citation and wording measures, for assist and draft. */
  m?: Measures;
  /** Citations to passages not in the request, before the whitelist removed them. */
  hallucinated?: number;
  /** ADR-0135: another setting written as the thesis's own. */
  setting?: SettingMeasures;
  /** Outline only (ADR-0092 addendum 4): the plan's shape, counted in code. */
  shape?: OutlineShape;
};

type OutlineShape = {
  /** Sections of the Literature Review chapter. */
  lrSections: number;
  /** Sub-sections (third level) anywhere, and those outside Literature Review and Methodology. */
  subSections: number;
  subSectionsElsewhere: number;
};

/** Counts the plan's shape: the Literature Review's sections and where the sub-sections sit. */
function outlineShape(nodes: readonly OutlineNode[]): OutlineShape {
  let subSections = 0;
  let subSectionsElsewhere = 0;
  let lrSections = 0;
  for (const chapter of nodes) {
    const isLr = /literature/i.test(chapter.title);
    const isMethod = /method/i.test(chapter.title);
    if (isLr) lrSections += chapter.children.length;
    for (const section of chapter.children) {
      const below = countNodes(section.children);
      subSections += below;
      if (!isLr && !isMethod) subSectionsElsewhere += below;
    }
  }
  return { lrSections, subSections, subSectionsElsewhere };
}

function countNodes(nodes: readonly OutlineNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

type ChatMeasures = {
  /** Citations of a passage not in the request, before the whitelist stripped them. */
  hallucinated: number;
  /** Markdown headings in the answer. */
  headings: number;
  /** Sentences outside headings, and how many of them carry a citation. */
  sentences: number;
  citedSentences: number;
  words: number;
};

/** `--tier strong`: the chat answer's tier (ADR-0074); the configured default otherwise. */
const chatTier: 'fast' | 'strong' = process.argv.includes('--tier')
  ? process.argv[process.argv.indexOf('--tier') + 1] === 'strong'
    ? 'strong'
    : 'fast'
  : 'fast';

/** Structure and grounding of a chat answer, counted in code. */
function chatMeasures(text: string, hallucinated: number): ChatMeasures {
  const lines = text.split('\n');
  const headings = lines.filter((l) => /^#{1,4}\s/.test(l.trim())).length;
  const body = lines.filter((l) => !/^#{1,4}\s/.test(l.trim())).join(' ');
  const sentences = (body.match(/[^.!?]+[.!?]+(\s*\{\{cite:[^}]+\}\})*/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.replace(/\{\{cite:[^}]+\}\}/g, '').trim().length > 20);
  return {
    hallucinated,
    headings,
    sentences: sentences.length,
    citedSentences: sentences.filter((s) => s.includes('{{cite:')).length,
    words: body
      .replace(/\{\{cite:[^}]+\}\}/g, '')
      .split(/\s+/)
      .filter(Boolean).length,
  };
}
type Case = {
  id: string;
  topic: Topic;
  context: string;
  passages: PromptPassage[];
  /**
   * ADR-0075 (B8): the cursor is in an empty section, under its heading. `before` is the heading
   * line, as the editor sends it, and the scope note carries the section's own note.
   */
  emptySection?: boolean;
  /**
   * ADR-0135: Start writing now. The thesis has only its title; the cursor is under the empty
   * "Chapter 1", which has no scope note; the memory holds the working title and nothing else.
   */
  opener?: boolean;
  /**
   * ADR-0092 addendum 4: an outline planned from the title alone, as Start writing now asks for
   * it (`fromTitle`, generate-outline.ts): the working title, an empty problem statement, no
   * objectives and no gap map.
   */
  titleOnly?: boolean;
  kind:
    | 'assist'
    | 'draft'
    | 'chat'
    | 'chat_deep'
    | 'expand'
    | 'formalise'
    | 'outline'
    | 'proposal'
    | 'queries'
    | 'themes'
    | 'viva_questions'
    | 'revise';
};

/**
 * ADR-0075's case set (`--set copying`): every assist and draft case of the earlier rounds, the
 * production case from the side-by-side study (Karnataka, Bagla 2026), and for assist one empty
 * section per thesis (B8: what is offered before the student has written anything).
 */
function copyingCases(name: string): Case[] {
  const topics = [...TOPICS, KARNATAKA];
  const cases: Case[] = [];
  const passagesOf = (topic: Topic, count: number): PromptPassage[] => {
    const passages = passagesFor(topic, count);
    if (topic !== KARNATAKA) return passages;
    const bagla = passages[0] as PromptPassage;
    return [{ id: 'S1#c2', shortRef: bagla.shortRef, page: 11, text: BAGLA_P11 }, ...passages];
  };
  for (const topic of topics) {
    if (name === 'assist') {
      topic.befores.forEach((before, i) => {
        cases.push({
          id: `${topic.id}-${i + 1}`,
          topic,
          context: before,
          passages: passagesOf(topic, 6),
          kind: 'assist',
        });
      });
      cases.push({
        id: `${topic.id}-empty`,
        topic,
        context: `${topic.section.title}\n`,
        passages: passagesOf(topic, 6),
        kind: 'assist',
        emptySection: true,
      });
    } else if (name === 'draft') {
      cases.push({
        id: topic.id,
        topic,
        context: topic.section.title,
        passages: passagesOf(topic, 8),
        kind: 'draft',
      });
    }
  }
  return cases;
}

/**
 * ADR-0078's case set (`--set own-study`): a draft under a heading the student typed, from real
 * full-text passages, four of which call their own paper "this study". The real-model run of
 * 2026-10-05 carried the phrase into the thesis ("the framework used in this study"); the abstracts
 * of the other sets never did. The scope note is the worker's `headingOnlyScope`.
 */
function ownStudyCases(name: string): Case[] {
  if (name !== 'draft') return [];
  const fixture = JSON.parse(
    readFileSync(join(here, 'papers', 'karnataka-own-study.json'), 'utf8'),
  ) as { passages: PromptPassage[] };
  return ['Financial constraints', 'Subsidy experience'].map((title) => ({
    id: `karnataka-${title.toLowerCase().replace(/\s+/g, '-')}`,
    topic: {
      ...KARNATAKA,
      section: {
        title,
        scopeNote: `${title} in "${KARNATAKA.thesisTitle}", and only that. Every other topic, however close, belongs to another section: leave it out.`,
      },
    },
    context: title,
    passages: fixture.passages,
    kind: 'draft' as const,
  }));
}

/**
 * ADR-0079's case set (`--set aims`): the same-topic run's thesis, with nine real full-text
 * chunks of its library, six of which state what their own paper aims to do, focuses on or where
 * it was conducted. The real-model run of 2026-10-05 restated them as the thesis's own ("The
 * study focuses on rural women in Virudhunagar district {{cite:…}}"). Assist: the three typed
 * sentences and the empty section, as the copying set does; draft: the section.
 */
function aimsCases(name: string): Case[] {
  const fixture = JSON.parse(readFileSync(join(here, 'papers', 'tamilnadu-aims.json'), 'utf8')) as {
    passages: PromptPassage[];
  };
  const topic = TAMILNADU;
  if (name === 'draft') {
    return [
      {
        id: `${topic.id}-draft`,
        topic,
        context: topic.section.title,
        passages: fixture.passages,
        kind: 'draft',
      },
    ];
  }
  if (name !== 'assist') return [];
  // Two requests per cursor position: all nine passages, and the six that state only aims — what
  // retrieval returned in the real run, where the scope and problem-statement chunks matched the
  // sentence best and no finding was in the request.
  const aimsOnly = fixture.passages.filter((p) => !FINDING_PASSAGES.has(p.id));
  const cases: Case[] = [];
  for (const [label, passages] of [
    ['mixed', fixture.passages],
    ['aims-only', aimsOnly],
  ] as const) {
    topic.befores.forEach((before, i) => {
      cases.push({
        id: `${topic.id}-${label}-${i + 1}`,
        topic,
        context: before,
        passages,
        kind: 'assist',
      });
    });
    cases.push({
      id: `${topic.id}-${label}-empty`,
      topic,
      context: `${topic.section.title}\n`,
      passages,
      kind: 'assist',
      emptySection: true,
    });
  }
  // The real condition: the third suggestion in a row, when the paragraph has already said what
  // the aims passages say. The fault appeared there, never on the first sentence.
  EXHAUSTED.forEach((before, i) => {
    cases.push({
      id: `${topic.id}-exhausted-${i + 1}`,
      topic,
      context: before,
      passages: aimsOnly,
      kind: 'assist',
    });
  });
  return cases;
}

/**
 * ADR-0135's case set (`--set opener`): the Start-writing-now opener on a fresh 15-paper library
 * (`eval/fetch-fresh.ts`), for five theses that each name a place. Two retrieval conditions per
 * thesis: `chapter1`, the six abstracts today's query ("Chapter 1") ranks first, and `titled`, the
 * six ranked first once the working title stands in for the empty scope note.
 */
function openerCases(name: string, keralaInRequest = false): Case[] {
  if (name !== 'assist') return [];
  const cases: Case[] = [];
  // `--set opener-kerala` (a diagnostic, not part of the criterion): the Karnataka thesis with the
  // pool's Kerala paper put second in the request, as the live request had Mathew (2024) second.
  for (const topic of keralaInRequest ? FRESH.slice(0, 1) : FRESH) {
    const fixture = JSON.parse(readFileSync(join(here, 'papers', `${topic.id}.json`), 'utf8')) as {
      papers: Array<{ title: string; year: number | null; authors: string[]; abstract: string }>;
      rankings: { chapter1: number[]; titled: number[] };
    };
    const kerala = fixture.papers.findIndex((p) => /kerala/i.test(p.title));
    for (const condition of ['chapter1', 'titled'] as const) {
      const order = keralaInRequest
        ? (() => {
            const rest = fixture.rankings[condition].filter((i) => i !== kerala);
            return [rest[0] as number, kerala, ...rest.slice(1, 5)];
          })()
        : fixture.rankings[condition].slice(0, 6);
      const passages = order.map((index, i) => {
        const paper = fixture.papers[index] as (typeof fixture.papers)[number];
        return {
          id: `S${i + 1}#c1`,
          shortRef: shortRefOf(paper),
          page: null,
          text: paper.abstract,
        };
      });
      cases.push({
        id: `${topic.id}-${condition}${keralaInRequest ? '-kerala' : ''}`,
        topic,
        context: 'Chapter 1\n',
        passages,
        kind: 'assist',
        opener: true,
      });
    }
  }
  return cases;
}

function shortRefOf(p: { authors: string[]; year: number | null }): string {
  const last = (p.authors[0] ?? 'Anon').split(/\s+/).pop() ?? 'Anon';
  const etal =
    p.authors.length > 2
      ? ' et al.'
      : p.authors.length === 2
        ? ` & ${p.authors[1]?.split(/\s+/).pop()}`
        : '';
  return `${last}${etal} ${p.year ?? 'n.d.'}`;
}

/** A.0.1 for a thesis made by Start writing now: the title, and one chapter with no scope note. */
function openerMemory(topic: Topic): string {
  return buildMemoryBlock({
    scope: { workingTitle: topic.thesisTitle, problemStatement: '', objectives: [], whyOpen: '' },
    outline: [{ id: 'ch-1', title: 'Chapter 1', scopeNote: '', children: [] }],
    glossary: {},
    styleProfile: null,
    chapter: { outlineNodeId: 'ch-1', text: '' },
  }).text;
}

/**
 * ADR-0135: sentences naming another state or country than the thesis's own without saying it is
 * one (`unmarkedOtherSettings`), and whether the first sentence is set in the thesis's own place.
 */
type SettingMeasures = { mismatched: number; sentences: string[]; firstOwn: boolean | null };
function settingMeasures(text: string, c: Case): SettingMeasures {
  const scope = [c.topic.thesisTitle, c.topic.chapter.scopeNote, c.topic.section.scopeNote].join(
    '\n',
  );
  const sentences = splitSentences(text.replace(/\n+/g, ' '));
  const bad = sentences.filter((s) => unmarkedOtherSettings(s, scope).length > 0);
  const own = ownPlaces(placesIn(scope));
  const first = sentences[0];
  return {
    mismatched: bad.length,
    sentences: bad,
    firstOwn: first ? [...placesIn(first)].some((p) => own.has(p)) : null,
  };
}

/** The three passages of `tamilnadu-aims.json` that report findings rather than aims. */
const FINDING_PASSAGES = new Set(['S1#c30', 'S2#c29', 'S2#c4']);

/** Paragraphs that have already used the aims passages' content, as the real run's had. */
const EXHAUSTED = [
  'Mobile banking is spreading in rural Tamil Nadu, but rural women take it up more slowly than men. Rural women in Virudhunagar district face low digital literacy, limited access to smartphones and socio-cultural restrictions, which delay their use of mobile banking and digital wallets (Mathivathana & Alagulakshmi 2025). Trust issues and a lack of awareness reduce adoption further, and women often have little control over the household phone or account (Mathivathana & Alagulakshmi 2025).',
  'Digital literacy is the barrier most often named in the Indian studies. In Virudhunagar district, women manage household finances and contribute through farm work and small enterprises, yet their access to formal financial services and digital tools is constrained by limited digital literacy, poor internet infrastructure and established gender norms (Mathivathana & Alagulakshmi 2025). Reviews of the wider literature find the same pattern across rural and urban India, with rural women facing the larger gap in access, literacy and trust (Sneha & Patil 2026; Sowmya 2025).',
];

function casesFor(name: string): Case[] {
  const cases: Case[] = [];
  for (const topic of TOPICS) {
    if (name === 'assist') {
      topic.befores.forEach((before, i) => {
        cases.push({
          id: `${topic.id}-${i + 1}`,
          topic,
          context: before,
          passages: passagesFor(topic, 6),
          kind: 'assist',
        });
      });
    } else if (name === 'draft') {
      cases.push({
        id: topic.id,
        topic,
        context: topic.section.title,
        passages: passagesFor(topic, 8),
        kind: 'draft',
      });
    } else if (name === 'chat' || name === 'chat_deep') {
      // ADR-0080's round: the same questions and passages, A.4's answer against the planned deep
      // answer (`kind: 'chat_deep'`), judged as answers to a student starting a section.
      const kind = name;
      topic.questions.forEach((question, i) => {
        cases.push({
          id: `${topic.id}-q${i + 1}`,
          topic,
          context: question,
          passages: passagesFor(topic, 8),
          kind,
        });
      });
      // ADR-0074: the side-by-side's own question (C2), asked as the research path asks it: five
      // library papers and three abstracts a search found, marked as such.
      if (topic.id === 'rooftop-solar-india') {
        cases.push({
          id: `${topic.id}-c2`,
          topic,
          context:
            'What are the main financial barriers to rooftop solar adoption for rural households in India, according to my sources?',
          passages: passagesFor(topic, 8).map((p, i) =>
            i >= 5 ? { ...p, id: `Sweb${i - 4}#cabstract`, origin: 'search' as const } : p,
          ),
          kind,
        });
      }
    } else if (name === 'command') {
      cases.push({
        id: `${topic.id}-expand`,
        topic,
        context: topic.befores.join(' '),
        passages: passagesFor(topic, 6),
        kind: 'expand',
      });
      cases.push({
        id: `${topic.id}-formalise`,
        topic,
        context: topic.informal,
        passages: [],
        kind: 'formalise',
      });
    } else if (name === 'outline') {
      cases.push({
        id: topic.id,
        topic,
        context: topic.thesisTitle,
        passages: [],
        kind: 'outline',
      });
      // ADR-0092 addendum 4: the same thesis planned from its title alone (Start writing now).
      cases.push({
        id: `${topic.id}-title`,
        topic,
        context: topic.thesisTitle,
        passages: [],
        kind: 'outline',
        titleOnly: true,
      });
    } else if (name === 'proposal') {
      cases.push({ id: topic.id, topic, context: topic.idea, passages: [], kind: 'proposal' });
    } else if (name === 'queries') {
      cases.push({
        id: topic.id,
        topic,
        context: topic.thesisTitle,
        passages: [],
        kind: 'queries',
      });
    } else if (name === 'themes') {
      // The topic's papers plus two from the next field, as a search's noise would add.
      const next = TOPICS[(TOPICS.indexOf(topic) + 1) % TOPICS.length] as Topic;
      const passages = [
        ...passagesFor(topic, 8),
        ...passagesFor(next, 2).map((p, i) => ({ ...p, id: `X${i + 1}#c1` })),
      ];
      cases.push({ id: topic.id, topic, context: topic.thesisTitle, passages, kind: 'themes' });
    } else if (name === 'viva_questions') {
      cases.push({
        id: topic.id,
        topic,
        context: draftedSection(topic).shown,
        passages: [],
        kind: 'viva_questions',
      });
    } else if (name === 'revise') {
      REVISE_COMMENTS(topic).forEach((comment, i) => {
        cases.push({
          id: `${topic.id}-c${i + 1}`,
          topic,
          context: comment,
          passages: passagesFor(topic, 8),
          kind: 'revise',
        });
      });
    }
  }
  return cases;
}

/** A guide's comments of the two kinds students most often get on a review paragraph. */
function REVISE_COMMENTS(topic: Topic): string[] {
  return [
    'Compare these studies directly: where do their findings agree and where do they differ?',
    `Make clear which of these findings apply to your own subject (${topic.thesisTitle.toLowerCase()}) and which come from a different material or setting.`,
  ];
}

/** The first paragraph of prose in a drafted section, headings skipped. */
function firstParagraph(markdown: string): string {
  return (
    markdown
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p.length > 80 && !p.startsWith('#')) ?? markdown
  );
}

/** Outline nodes as the student sees them in the outline tree. */
function outlineText(nodes: readonly OutlineNode[], depth = 0): string {
  return nodes
    .map(
      (n) =>
        `${'  '.repeat(depth)}- ${n.title}: ${n.scopeNote}\n${outlineText(n.children, depth + 1)}`,
    )
    .join('');
}

/** The proposal conversation as production runs it, with the student's answers scripted. */
async function proposalConversation(llm: LlmProvider, topic: Topic): Promise<Output> {
  const works = papersFor(topic).map((p) => ({
    title: p.title,
    year: p.year,
    abstract: p.abstract.split(/(?<=\.)\s/)[0] ?? '',
  }));
  const gapCheck = { count: works.length, works };
  const answers = [
    `Mainly this: ${topic.thesisTitle}.`,
    `Specifically: ${topic.section.scopeNote}`,
    "No other constraints; it is a standard master's thesis.",
  ];
  const history: ProposalTurn[] = [{ role: 'user', text: topic.idea }];
  const shown: string[] = [`Student: ${topic.idea}`];
  for (let turn = 0; turn < 5; turn++) {
    const request = buildProposalRequest({ history, gapCheck, userId: 'eval', documentId: 'eval' });
    const { text } = await streamText(llm, request);
    const reply = parseProposalReply(text);
    history.push({ role: 'assistant', text });
    if (reply.kind === 'skeleton') {
      shown.push(`Proposal skeleton:\n${JSON.stringify(reply.skeleton, null, 2)}`);
      return { raw: text, text, shown: shown.join('\n\n'), cited: 0, empty: false, dropped: 0 };
    }
    const questions = history.filter((t) => t.role === 'assistant').length;
    if (reply.kind === 'question' && questions <= 3) {
      shown.push(`Assistant: ${reply.text}`);
      const answer = answers[questions - 1] ?? (answers[2] as string);
      history.push({ role: 'user', text: answer });
      shown.push(`Student: ${answer}`);
    } else {
      history.push({ role: 'user', text: SKELETON_INSTRUCTION });
    }
  }
  return { raw: '', text: '', shown: '', cited: 0, empty: true, dropped: 0 };
}

async function produce(
  llm: LlmProvider,
  c: Case,
  side: 'current' | 'candidate' = 'current',
): Promise<Output> {
  if (c.kind === 'proposal') return proposalConversation(llm, c.topic);
  const done = (text: string): Output => ({
    raw: text,
    text,
    shown: text,
    cited: 0,
    empty: text.trim() === '',
    dropped: 0,
  });
  const scope = {
    workingTitle: c.topic.thesisTitle,
    problemStatement: c.topic.chapter.scopeNote,
    objectives: [c.topic.section.scopeNote],
  };
  if (c.kind === 'queries') {
    const request = buildQueriesRequest({ scope, userId: 'eval', documentId: 'eval' });
    const result = await llm.complete({ ...request, schema: queriesSchema });
    return done(
      cleanQueries(result.value, c.topic.thesisTitle)
        .map((q) => `- (${q.angle}) ${q.q}`)
        .join('\n'),
    );
  }
  if (c.kind === 'themes') {
    const next = TOPICS[(TOPICS.indexOf(c.topic) + 1) % TOPICS.length] as Topic;
    const candidates = [
      ...papersFor(c.topic).map((p, i) => ({
        id: `S${i + 1}#c1`,
        title: p.title,
        abstract: p.abstract,
      })),
      ...papersFor(next)
        .slice(0, 2)
        .map((p, i) => ({ id: `X${i + 1}#c1`, title: p.title, abstract: p.abstract })),
    ];
    const request = buildThemesRequest({ scope, candidates, userId: 'eval', documentId: 'eval' });
    const result = await llm.complete({ ...request, schema: themesSchema });
    const themes = normaliseThemes(
      result.value,
      candidates.map((x) => x.id),
    );
    const title = new Map(candidates.map((x) => [x.id, x.title]));
    return done(
      themes
        .map(
          (t) =>
            `${t.name}${t.thin ? ' (thin)' : ''}:\n${t.candidateIds.map((id) => `  - ${title.get(id)}`).join('\n')}`,
        )
        .join('\n'),
    );
  }
  if (c.kind === 'viva_questions') {
    const passages = c.context
      .split(/\n\s*\n/)
      .filter((p) => p.trim().length > 80 && !p.trim().startsWith('#'))
      .map((text, i) => ({
        id: `p${i + 1}`,
        chapterTitle: c.topic.chapter.title,
        text: text.trim(),
      }));
    const request = buildVivaQuestionsRequest({
      title: c.topic.thesisTitle,
      passages,
      userId: 'eval',
      documentId: 'eval',
    });
    const result = await llm.complete({ ...request, schema: vivaQuestionsSchema });
    const { questions } = postProcessVivaQuestions(
      result.value,
      new Set(passages.map((p) => p.id)),
    );
    return done(
      questions
        .map((q) => `- [${q.kind}, ${q.passageId}] ${q.question} (tests: ${q.probing})`)
        .join('\n'),
    );
  }
  if (c.kind === 'revise') {
    const target = firstParagraph(draftedSection(c.topic).raw);
    const request = buildReviseRequest({
      memoryBlock: memoryFor(c.topic, draftedSection(c.topic).raw),
      comment: c.context,
      commentClass: 'SUBSTANTIVE',
      target,
      contextBefore: '',
      contextAfter: '',
      passages: c.passages,
      userId: 'eval',
      documentId: 'eval',
    });
    const { text } = await streamText(llm, request);
    const processed = postProcessRevision(
      text,
      target,
      c.passages.map((p) => p.id),
    );
    const shown = readable(processed.text, c.passages);
    const notes = processed.needsInput.map((n) => `\n[Needs input: ${n}]`).join('');
    return { ...done(shown + notes), raw: text };
  }
  if (c.kind === 'outline') {
    const template = 'STEM_EMPIRICAL' as const;
    // A title-only plan is the request generate-outline.ts sends for `fromTitle`: the scope its
    // `readScope({ workingTitle })` makes, and no gap map (none exists yet).
    const request = buildOutlineRequest({
      template,
      scope: c.titleOnly
        ? { workingTitle: c.topic.thesisTitle, problemStatement: '', objectives: [] }
        : {
            workingTitle: c.topic.thesisTitle,
            problemStatement: c.topic.chapter.scopeNote,
            objectives: [c.topic.section.scopeNote],
          },
      gapMap: c.titleOnly
        ? []
        : c.topic.themes.map((name, i) => ({ name, count: i === 2 ? 2 : 3, thin: i === 2 })),
      userId: 'eval',
      documentId: 'eval',
    });
    const result = await llm.complete({ ...request, schema: outlineRequestSchema });
    // As the worker keeps it: the template's shape, then any slot sections dropped.
    const nodes = dropPlaceholderSections(
      enforceTemplateShape(normaliseOutline(readOutlineResult(result.value)), template),
    );
    const text = outlineText(nodes);
    return {
      raw: text,
      text,
      shown: text,
      cited: 0,
      empty: nodes.length === 0,
      dropped: 0,
      shape: outlineShape(nodes),
    };
  }
  if (c.kind === 'assist') {
    // As production builds it under a section heading (`scopeWithSection`, assist.service.ts).
    const scopeNote = c.opener
      ? null
      : c.emptySection
        ? `${c.topic.chapter.scopeNote}\nThis section, "${c.topic.section.title}": ${c.topic.section.scopeNote}`
        : c.topic.chapter.scopeNote;
    const request = buildAssistRequest({
      memoryBlock: c.opener ? openerMemory(c.topic) : memoryFor(c.topic, c.context),
      chapter: { title: c.topic.chapter.title, scopeNote },
      passages: c.passages,
      before: c.context,
      after: '',
      userId: 'eval',
      documentId: 'eval',
    });
    const { text } = await streamText(llm, request);
    const processed = postProcessAssist({
      output: text,
      passageIds: c.passages.map((p) => p.id),
      before: c.context,
      existingText: c.context,
    });
    const dropped = Object.values(processed.drops).reduce((a, b) => a + b, 0);
    return {
      raw: text,
      text: processed.text,
      shown: readable(processed.text, c.passages),
      cited: processed.cited.length,
      empty: processed.empty,
      dropped,
      m: measure(processed.text, c.passages),
      hallucinated: processed.hallucinated.length,
      setting: settingMeasures(readable(processed.text, c.passages), c),
    };
  }
  if (c.kind === 'chat_deep' && side === 'candidate') {
    // The plan on the real strong model, then the deep answer over the same passages.
    const planned = await llm.complete({
      ...buildResearchPlanRequest({
        scope: {
          workingTitle: c.topic.thesisTitle,
          problemStatement: c.topic.chapter.scopeNote,
          objectives: [c.topic.section.scopeNote],
        },
        question: c.context,
        userId: 'eval',
        documentId: 'eval',
      }),
      schema: researchPlanSchema,
    });
    const plan = cleanResearchPlan(planned.value);
    const request = buildDeepChatRequest({
      memoryBlock: memoryFor(c.topic, ''),
      question: c.context,
      history: [],
      passages: c.passages,
      filters: {},
      userId: 'eval',
      documentId: 'eval',
      plan: plan.length > 0 ? plan : [{ title: 'The question', question: c.context, query: '' }],
      maxPassages: c.passages.length,
    });
    const { text } = await streamText(llm, request);
    const processed = postProcessChat(
      text,
      c.passages.map((p) => p.id),
    );
    return {
      raw: `PLAN: ${plan.map((p) => p.title).join(' · ')}\n\n${text}`,
      text: processed.text,
      shown: readable(processed.text, c.passages),
      cited: processed.cited.length,
      empty: processed.text.trim().length === 0,
      dropped: 0,
      chat: chatMeasures(processed.text, processed.hallucinated.length),
    };
  }
  if (c.kind === 'chat' || c.kind === 'chat_deep') {
    const request = buildChatRequest({
      memoryBlock: memoryFor(c.topic, ''),
      question: c.context,
      history: [],
      passages: c.passages,
      filters: {},
      userId: 'eval',
      documentId: 'eval',
      tier: chatTier,
      maxPassages: c.passages.length,
    });
    const { text } = await streamText(llm, request);
    const processed = postProcessChat(
      text,
      c.passages.map((p) => p.id),
    );
    return {
      raw: text,
      text: processed.text,
      shown: readable(processed.text, c.passages),
      cited: processed.cited.length,
      empty: processed.text.trim().length === 0,
      dropped: 0,
      chat: chatMeasures(processed.text, processed.hallucinated.length),
    };
  }
  if (c.kind === 'expand' || c.kind === 'formalise') {
    const request = buildCommandRequest({
      command: c.kind,
      memoryBlock: memoryFor(c.topic, c.context),
      selection: c.context,
      contextBefore: '',
      contextAfter: '',
      passages: c.passages,
      userId: 'eval',
      documentId: 'eval',
    });
    const result = await llm.complete({ ...request, schema: commandResultSchema });
    const processed = postProcessCommand(
      result.value.text,
      c.context,
      c.passages.map((p) => p.id),
    );
    const cited = new Set([...processed.text.matchAll(/\{\{cite:([^}]+)\}\}/g)].map((m) => m[1]))
      .size;
    return {
      raw: result.value.text,
      text: processed.text,
      shown: readable(processed.text, c.passages),
      cited,
      empty: processed.text.trim().length === 0,
      dropped: 0,
    };
  }
  const request = buildDraftRequest({
    memoryBlock: memoryFor(c.topic, ''),
    section: {
      outlineNodeId: 'sec-1',
      title: c.topic.section.title,
      scopeNote: c.topic.section.scopeNote,
      children: [],
    },
    passages: c.passages,
    targetWords: 400,
    tier: 'strong',
    userId: 'eval',
    documentId: 'eval',
  });
  const { text } = await streamText(llm, request);
  const processed = postProcessDraft(text, c.passages, 400, '');
  return {
    raw: text,
    text: processed.result.markdown,
    shown: readable(processed.result.markdown, c.passages),
    cited: processed.result.citations.length,
    empty: processed.result.markdown.trim().length === 0,
    dropped: 0,
    m: measure(processed.result.markdown, c.passages),
    hallucinated: processed.hallucinated.length,
  };
}

/** A call that fails is what the student would get too: nothing. Counted, not fatal. */
const failures = { current: 0, candidate: 0 };
async function safely(llm: LlmProvider, c: Case, side: 'current' | 'candidate'): Promise<Output> {
  try {
    return await produce(llm, c, side);
  } catch (error) {
    failures[side]++;
    console.log(`${c.id}: ${side} FAILED: ${(error as Error).message.slice(0, 120)}`);
    return {
      text: '',
      shown: '',
      cited: 0,
      empty: true,
      dropped: 0,
      raw: `FAILED: ${(error as Error).message}`,
    };
  }
}

const judgeSchema = z.object({
  better: z.enum(['FIRST', 'SECOND', 'EQUAL']),
  firstScore: z.number(),
  secondScore: z.number(),
  reason: z.string(),
});

async function judge(llm: LlmProvider, c: Case, first: string, second: string) {
  const sources = c.passages.map((p) => `[${p.shortRef}] ${p.text}`).join('\n\n');
  const outlineTask = c.titleOnly
    ? "Each candidate is a thesis outline planned from the working title alone, before any literature was searched (chapters and sections, each with a scope note telling the writer what to establish and what not to cover). A better outline fits this specific thesis: its sections and scope notes name the thesis's likely material, method, population and questions rather than generic headings; the literature review is divided into the themes a reviewer of this topic would expect, so the student has sections to write under; each scope note is a clear, specific instruction; nothing important for this thesis is missing and nothing is padding."
    : "Each candidate is a thesis outline (chapters and sections, each with a scope note telling the writer what to establish and what not to cover). A better outline fits this specific thesis: its sections and scope notes name the thesis's actual material, method, population and questions rather than generic headings; the literature review follows the themes given, and says where sources are thin; each scope note is a clear, specific instruction; nothing important for this thesis is missing and nothing is padding.";
  const task = {
    assist:
      'Each candidate is the next one or two sentences the writing assistant offers after the student text. An empty candidate means the assistant offered nothing.',
    draft: 'Each candidate is a drafted section of the thesis.',
    chat: "Each candidate is the assistant's answer to the student's question about their sources. A better answer is direct, specific, synthesises across sources, cites each claim to a source that supports it, and says plainly when the sources do not answer the question.",
    chat_deep:
      "Each candidate is the assistant's answer to a student who asked about their sources while starting to write that section. A better answer is direct, specific, synthesises across sources, cites each claim to a source that supports it, says plainly what the sources do not answer, and gives the student as much as the sources genuinely support — organised so it can be used — without padding or claims the sources do not make.",
    expand:
      "Each candidate is the student's paragraph expanded by the assistant. A better expansion keeps the student's meaning, adds real depth from the sources with correct citations, and adds no unsupported claims or filler.",
    formalise:
      "Each candidate is the student's paragraph rewritten in formal academic English. A better rewrite keeps the meaning and every point, keeps about the same length, adds no new claims, and reads like a finished thesis.",
    outline: outlineTask,
    proposal:
      "Each candidate is a short conversation that turns a student's rough idea into a proposal skeleton (working title, problem statement, objectives, why the question is open). A better one asks few, sharp questions that offer concrete options relevant to the idea, and ends with a skeleton that is specific (names the material, method, population or setting), feasible for a master's thesis, has objectives a student can actually carry out and measure, and explains why the question is open using only the related works listed, without inventing any.",
    queries:
      'Each candidate is a set of search queries for an academic search engine, written to find the literature this thesis needs. A better set would find more of the relevant papers and fewer irrelevant ones: specific technical terms from this thesis, distinct angles that together cover its scope, no query so broad it returns other fields.',
    themes:
      'Each candidate groups the candidate papers into literature-review themes. A better grouping has themes a reviewer of this thesis would recognise, named by topic, each paper in the theme it best fits, and papers from an unrelated field kept apart rather than forced into a theme.',
    viva_questions:
      'Each candidate is the set of questions an external examiner would ask about this passage in the viva. Better questions are specific to what the passage actually says, make the student justify choices, defend claims or own limitations, are fair and answerable, and do not simply ask the student to repeat the passage.',
    revise:
      "Each candidate is the paragraph revised to address the guide's comment. A better revision does what the comment asks using only what the sources support, keeps the rest of the paragraph and its citations intact, and adds no unsupported claims.",
  }[c.kind];
  const studentText = {
    assist: c.opener
      ? 'The student has just created this thesis from its title, and the cursor is in the empty first chapter (heading "Chapter 1", no plan yet); nothing is written. The candidate is the first sentence or two offered to open the thesis.'
      : c.emptySection
        ? `The student has written only the section heading "${c.topic.section.title}" (the section is meant to cover: ${c.topic.section.scopeNote}) and nothing under it yet. The candidate is the first sentence or two offered for this empty section.`
        : `Student text before the cursor:
${c.context}`,
    draft: `Section to draft: ${c.topic.section.title}. ${c.topic.section.scopeNote}`,
    chat: `Student's question:
${c.context}`,
    expand: `Student's paragraph:
${c.context}`,
    formalise: `Student's paragraph:
${c.context}`,
    outline: c.titleOnly
      ? 'The student has given only the working title: no problem statement, no objectives, and no literature has been searched yet.'
      : `Themes found in the literature (the last has only two sources): ${c.topic.themes.join('; ')}`,
    queries: `Scope: ${c.topic.chapter.scopeNote} Objective: ${c.topic.section.scopeNote}`,
    themes: 'Candidate papers found by the search are listed under Sources, by title and abstract.',
    viva_questions: `The thesis passage the examiner questions:\n${c.context}`,
    // Only built for a revise case: the copying round's Karnataka topic has no drafted section.
    revise:
      c.kind === 'revise'
        ? `The guide's comment: ${c.context}\n\nThe paragraph it is on:\n${firstParagraph(draftedSection(c.topic).shown)}`
        : '',
    // Only built for a proposal case: a fresh topic's paper file (ADR-0135) is not a paper list.
    proposal:
      c.kind === 'proposal'
        ? `Related works found for the idea:
${papersFor(c.topic)
  .map((p) => `- ${p.title} (${p.year})`)
  .join('\n')}`
        : '',
  }[c.kind];
  const answer = await llm.complete({
    tier: 'strong',
    action: 'COHERENCE',
    userId: 'eval',
    maxTokens: 600,
    system: {
      cached: [
        'You are an experienced thesis examiner comparing two pieces of AI-assisted thesis writing. Judge them as the examiner of this thesis would.',
        'A better piece: makes specific, technical statements (materials, methods, conditions, numbers, populations, outcomes) drawn from the sources; cites them, and every citation matches what that source actually says; reads as a finished thesis, not a plan ("this section will…"); does not repeat the student text or itself; follows naturally from the student text; is not generic filler that could appear in any thesis.',
        'A worse piece: generic, vague, uncited claims about research, citations that do not support the sentence, filler, repetition, future-tense plans.',
        'Offering nothing is better than offering filler or a wrong citation, and worse than offering a good, correctly cited sentence.',
        'Score each from 1 (useless or harmful) to 10 (what a strong student would write with these sources). Output JSON only.',
      ].join('\n'),
    },
    messages: [
      {
        role: 'user',
        content: [
          `Thesis: ${c.topic.thesisTitle}`,
          // A title-only plan's model saw no more than the title; neither does its judge.
          ...(c.titleOnly
            ? []
            : [`Chapter: ${c.topic.chapter.title}. ${c.topic.chapter.scopeNote}`]),
          studentText,
          `Sources available:\n${sources || '(none: this task uses no sources)'}`,
          task,
          `FIRST:\n${first || '(nothing offered)'}`,
          `SECOND:\n${second || '(nothing offered)'}`,
        ].join('\n\n'),
      },
    ],
    schema: judgeSchema,
  });
  return answer.value;
}

async function main(): Promise<void> {
  const name = process.argv[2] as PromptName;
  const samples = Number(process.argv[process.argv.indexOf('--samples') + 1] || 1) || 1;
  // --model <id>: B is the *current* prompt on another fast-tier model (2026-10-04, choosing the
  // Assist model). Without it, B is `eval/candidates/<name>.md` on the same model, as before.
  const modelB = process.argv.includes('--model')
    ? process.argv[process.argv.indexOf('--model') + 1]
    : undefined;
  // ADR-0075: --candidate <file> picks one of several candidates for the same prompt
  // (`eval/candidates/<file>.md`); --set copying runs that round's cases; --no-judge measures
  // without the judge, which is most of the cost.
  const arg = (flag: string) =>
    process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined;
  const candidateName = arg('--candidate') ?? name;
  const set = arg('--set');
  const bOnly = process.argv.includes('--b-only');
  const noJudge = bOnly || process.argv.includes('--no-judge');
  const candidatePath = join(here, 'candidates', `${candidateName}.md`);
  if (!modelB && !existsSync(candidatePath)) throw new Error(`No candidate at ${candidatePath}`);
  const candidate = modelB ? null : readFileSync(candidatePath, 'utf8');

  const env = loadEnv();
  const meter = metered(createProviders(env).llm);
  const llm = meter.llm;
  // The judge and side A stay on the configured models; only side B's fast tier changes.
  const meterB = modelB ? metered(createProviders({ ...env, AI_FAST_MODEL: modelB }).llm) : meter;
  const llmB = meterB.llm;
  if (modelB) console.log(`A: ${env.AI_FAST_MODEL}   B: ${modelB}   judge: ${env.AI_STRONG_MODEL}`);
  const only = process.argv.includes('--only')
    ? process.argv[process.argv.indexOf('--only') + 1]
    : undefined;
  const cases = (
    set === 'copying'
      ? copyingCases(name)
      : set === 'own-study'
        ? ownStudyCases(name)
        : set === 'aims'
          ? aimsCases(name)
          : set === 'opener'
            ? openerCases(name)
            : set === 'opener-kerala'
              ? openerCases(name, true)
              : casesFor(name)
  ).filter((c) => !only || c.id.includes(only));
  const measured = { a: [] as Measures[], b: [] as Measures[] };
  const hallucinated = { a: 0, b: 0 };
  // ADR-0135: mismatched sentences, outputs with one, and first sentences set in the thesis's place.
  const setting = {
    a: { mismatched: 0, outputs: 0, firstOwn: 0, answered: 0 },
    b: { mismatched: 0, outputs: 0, firstOwn: 0, answered: 0 },
  };

  const rows: Array<Record<string, unknown>> = [];
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  const scores = { a: 0, b: 0 };
  const stats = { a: { empty: 0, cited: 0, dropped: 0 }, b: { empty: 0, cited: 0, dropped: 0 } };
  let n = 0;
  const timing = { a: [] as number[], b: [] as number[] };
  const zero = () => ({
    hallucinated: 0,
    headings: 0,
    answersWithHeadings: 0,
    sentences: 0,
    citedSentences: 0,
    words: 0,
    distinctCited: 0,
  });
  const chatTotals = { a: zero(), b: zero() };
  const outlineRuns: Array<{
    set: 'gapMap' | 'titleOnly';
    verdict: string;
    ms: { a: number; b: number };
    a?: OutlineShape;
    b?: OutlineShape;
  }> = [];
  /** ADR-0092 addendum 4: each set's verdicts, times and shapes, run by run. */
  const outlineSets = () =>
    Object.fromEntries(
      (['gapMap', 'titleOnly'] as const).map((set) => {
        const runs = outlineRuns.filter((r) => r.set === set);
        const side = (k: 'a' | 'b') => ({
          medianMs: median(runs.map((r) => r.ms[k])),
          lrSections: runs.map((r) => r[k]?.lrSections ?? 0),
          subSections: runs.map((r) => r[k]?.subSections ?? 0),
          subSectionsElsewhere: runs.map((r) => r[k]?.subSectionsElsewhere ?? 0),
        });
        return [
          set,
          {
            runs: runs.length,
            wins: {
              current: runs.filter((r) => r.verdict === 'A').length,
              candidate: runs.filter((r) => r.verdict === 'B').length,
              tie: runs.filter((r) => r.verdict === '=').length,
            },
            current: side('a'),
            candidate: side('b'),
          },
        ];
      }),
    );
  if (name === 'chat' || name === 'chat_deep') console.log(`chat tier: ${chatTier}`);

  for (const c of cases) {
    for (let s = 0; s < samples; s++) {
      overridePrompt(name, null);
      const startA = Date.now();
      // --b-only (ADR-0075): measure another candidate without paying for the current prompt
      // again; its numbers come from the run that measured it. Never combined with the judge.
      const a = bOnly
        ? { text: '', shown: '', cited: 0, empty: true, dropped: 0, raw: '' }
        : await safely(llm, c, 'current');
      timing.a.push(Date.now() - startA);
      overridePrompt(name, candidate);
      const startB = Date.now();
      const b = await safely(llmB, c, 'candidate');
      timing.b.push(Date.now() - startB);
      overridePrompt(name, null);

      const skipped = { better: 'EQUAL' as const, firstScore: 0, secondScore: 0, reason: '' };
      const j1 = noJudge ? skipped : await steadyJudge(llm, c, a.shown, b.shown);
      const j2 = noJudge ? skipped : await steadyJudge(llm, c, b.shown, a.shown);
      if (a.m) measured.a.push(a.m);
      if (b.m) measured.b.push(b.m);
      hallucinated.a += a.hallucinated ?? 0;
      hallucinated.b += b.hallucinated ?? 0;
      const aFirst = j1.better === 'FIRST' ? 'A' : j1.better === 'SECOND' ? 'B' : '=';
      const aSecond = j2.better === 'FIRST' ? 'B' : j2.better === 'SECOND' ? 'A' : '=';
      const verdict = aFirst === aSecond ? aFirst : '=';
      if (verdict === 'A') aWins++;
      else if (verdict === 'B') bWins++;
      else ties++;
      scores.a += (j1.firstScore + j2.secondScore) / 2;
      scores.b += (j1.secondScore + j2.firstScore) / 2;
      for (const [k, o] of [
        ['a', a],
        ['b', b],
      ] as const) {
        if (o.setting) {
          setting[k].mismatched += o.setting.mismatched;
          if (o.setting.mismatched > 0) setting[k].outputs++;
          if (o.setting.firstOwn !== null) setting[k].answered++;
          if (o.setting.firstOwn) setting[k].firstOwn++;
        }
        if (o.empty) stats[k].empty++;
        if (o.cited > 0) stats[k].cited++;
        stats[k].dropped += o.dropped;
        if (o.chat) {
          const t = chatTotals[k];
          t.hallucinated += o.chat.hallucinated;
          t.headings += o.chat.headings;
          if (o.chat.headings > 0) t.answersWithHeadings++;
          t.sentences += o.chat.sentences;
          t.citedSentences += o.chat.citedSentences;
          t.words += o.chat.words;
          t.distinctCited += o.cited;
        }
      }
      n++;
      if (c.kind === 'outline') {
        outlineRuns.push({
          set: c.titleOnly ? 'titleOnly' : 'gapMap',
          verdict,
          ms: { a: timing.a.at(-1) ?? 0, b: timing.b.at(-1) ?? 0 },
          a: a.shape,
          b: b.shape,
        });
      }
      rows.push({
        case: c.id,
        sample: s,
        verdict,
        ...(a.shape || b.shape ? { aShape: a.shape, bShape: b.shape } : {}),
        a: a.shown,
        b: b.shown,
        aRaw: a.raw,
        bRaw: b.raw,
        ...(a.setting || b.setting ? { aSetting: a.setting, bSetting: b.setting } : {}),
        ...(a.chat && b.chat
          ? { aMeasures: a.chat, bMeasures: b.chat }
          : a.m || b.m
            ? { aMeasures: a.m, bMeasures: b.m }
            : {}),
        reason1: j1.reason,
        reason2: j2.reason,
      });
      console.log(
        `${c.id}#${s}: ${verdict}  A ${((j1.firstScore + j2.secondScore) / 2).toFixed(1)}  B ${((j1.secondScore + j2.firstScore) / 2).toFixed(1)}`,
      );
    }
  }

  const summary = {
    prompt: name,
    runs: n,
    wins: { current: aWins, candidate: bWins, tie: ties },
    meanScore: { current: +(scores.a / n).toFixed(2), candidate: +(scores.b / n).toFixed(2) },
    answeredWithCitation: { current: stats.a.cited, candidate: stats.b.cited },
    offeredNothing: { current: stats.a.empty, candidate: stats.b.empty },
    sentencesFiltered: { current: stats.a.dropped, candidate: stats.b.dropped },
    failedCalls: failures,
    ...(measured.a.length || measured.b.length
      ? {
          candidateFile: candidateName,
          set: set ?? 'default',
          judged: !noJudge,
          hallucinatedCites: { current: hallucinated.a, candidate: hallucinated.b },
          setting: { current: setting.a, candidate: setting.b },
          measures: { current: totals(measured.a), candidate: totals(measured.b) },
        }
      : {}),
    medianMs: { current: median(timing.a), candidate: median(timing.b) },
    ...(name === 'outline' ? { candidateFile: candidateName, outlineSets: outlineSets() } : {}),
    ...(modelB ? { models: { current: env.AI_FAST_MODEL, candidate: modelB } } : {}),
    ...(name === 'chat' || name === 'chat_deep'
      ? {
          chatTier,
          chat: {
            current: { ...chatTotals.a, meanWords: Math.round(chatTotals.a.words / n) },
            candidate: { ...chatTotals.b, meanWords: Math.round(chatTotals.b.words / n) },
          },
        }
      : {}),
    spentRupees: +(meter.rupees() + (modelB ? meterB.rupees() : 0)).toFixed(2),
  };
  console.log(JSON.stringify(summary, null, 2));
  mkdirSync(join(here, 'results'), { recursive: true });
  writeFileSync(
    join(
      here,
      'results',
      `${candidateName}${modelB ? `-vs-${modelB}` : ''}${set ? `-${set}` : ''}${noJudge ? '-measured' : ''}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`,
    ),
    `${JSON.stringify({ summary, rows }, null, 2)}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/** The judge is a model too: one malformed verdict is retried once, then counted as a tie. */
async function steadyJudge(llm: LlmProvider, c: Case, first: string, second: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await judge(llm, c, first, second);
    } catch (error) {
      console.log(`${c.id}: judge failed (${(error as Error).message.slice(0, 80)})`);
    }
  }
  return { better: 'EQUAL' as const, firstScore: 0, secondScore: 0, reason: 'judge failed twice' };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : (s[Math.floor(s.length / 2)] ?? 0);
}
