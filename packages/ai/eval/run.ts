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
import { buildDraftRequest, postProcessDraft } from '../src/builder/draft.js';
import {
  buildOutlineRequest,
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
import { buildQueriesRequest, cleanQueries, queriesSchema } from '../src/builder/queries.js';
import { buildThemesRequest, normaliseThemes, themesSchema } from '../src/builder/themes.js';
import {
  buildVivaQuestionsRequest,
  postProcessVivaQuestions,
  vivaQuestionsSchema,
} from '../src/builder/viva.js';
import { createProviders } from '../src/factory.js';
import { overridePrompt, type PromptName } from '../src/prompts.js';
import type { LlmProvider, LlmRequest } from '../src/types.js';
import { metered } from './meter.js';
import { draftedSection, memoryFor, papersFor, passagesFor, readable } from './shared.js';
import { TOPICS, type Topic } from './topics.js';

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
};
type Case = {
  id: string;
  topic: Topic;
  context: string;
  passages: PromptPassage[];
  kind:
    | 'assist'
    | 'draft'
    | 'chat'
    | 'expand'
    | 'formalise'
    | 'outline'
    | 'proposal'
    | 'queries'
    | 'themes'
    | 'viva_questions'
    | 'revise';
};

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
    } else if (name === 'chat') {
      topic.questions.forEach((question, i) => {
        cases.push({
          id: `${topic.id}-q${i + 1}`,
          topic,
          context: question,
          passages: passagesFor(topic, 8),
          kind: 'chat',
        });
      });
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

async function produce(llm: LlmProvider, c: Case): Promise<Output> {
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
    const request = buildOutlineRequest({
      template,
      scope: {
        workingTitle: c.topic.thesisTitle,
        problemStatement: c.topic.chapter.scopeNote,
        objectives: [c.topic.section.scopeNote],
      },
      gapMap: c.topic.themes.map((name, i) => ({ name, count: i === 2 ? 2 : 3, thin: i === 2 })),
      userId: 'eval',
      documentId: 'eval',
    });
    const result = await llm.complete({ ...request, schema: outlineRequestSchema });
    const nodes = enforceTemplateShape(normaliseOutline(readOutlineResult(result.value)), template);
    const text = outlineText(nodes);
    return { raw: text, text, shown: text, cited: 0, empty: nodes.length === 0, dropped: 0 };
  }
  if (c.kind === 'assist') {
    const request = buildAssistRequest({
      memoryBlock: memoryFor(c.topic, c.context),
      chapter: { title: c.topic.chapter.title, scopeNote: c.topic.chapter.scopeNote },
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
    };
  }
  if (c.kind === 'chat') {
    const request = buildChatRequest({
      memoryBlock: memoryFor(c.topic, ''),
      question: c.context,
      history: [],
      passages: c.passages,
      filters: {},
      userId: 'eval',
      documentId: 'eval',
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
  };
}

/** A call that fails is what the student would get too: nothing. Counted, not fatal. */
const failures = { current: 0, candidate: 0 };
async function safely(llm: LlmProvider, c: Case, side: 'current' | 'candidate'): Promise<Output> {
  try {
    return await produce(llm, c);
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
  const task = {
    assist:
      'Each candidate is the next one or two sentences the writing assistant offers after the student text. An empty candidate means the assistant offered nothing.',
    draft: 'Each candidate is a drafted section of the thesis.',
    chat: "Each candidate is the assistant's answer to the student's question about their sources. A better answer is direct, specific, synthesises across sources, cites each claim to a source that supports it, and says plainly when the sources do not answer the question.",
    expand:
      "Each candidate is the student's paragraph expanded by the assistant. A better expansion keeps the student's meaning, adds real depth from the sources with correct citations, and adds no unsupported claims or filler.",
    formalise:
      "Each candidate is the student's paragraph rewritten in formal academic English. A better rewrite keeps the meaning and every point, keeps about the same length, adds no new claims, and reads like a finished thesis.",
    outline:
      "Each candidate is a thesis outline (chapters and sections, each with a scope note telling the writer what to establish and what not to cover). A better outline fits this specific thesis: its sections and scope notes name the thesis's actual material, method, population and questions rather than generic headings; the literature review follows the themes given, and says where sources are thin; each scope note is a clear, specific instruction; nothing important for this thesis is missing and nothing is padding.",
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
    assist: `Student text before the cursor:
${c.context}`,
    draft: `Section to draft: ${c.topic.section.title}. ${c.topic.section.scopeNote}`,
    chat: `Student's question:
${c.context}`,
    expand: `Student's paragraph:
${c.context}`,
    formalise: `Student's paragraph:
${c.context}`,
    outline: `Themes found in the literature (the last has only two sources): ${c.topic.themes.join('; ')}`,
    queries: `Scope: ${c.topic.chapter.scopeNote} Objective: ${c.topic.section.scopeNote}`,
    themes: 'Candidate papers found by the search are listed under Sources, by title and abstract.',
    viva_questions: `The thesis passage the examiner questions:\n${c.context}`,
    revise: `The guide's comment: ${c.context}\n\nThe paragraph it is on:\n${firstParagraph(draftedSection(c.topic).shown)}`,
    proposal: `Related works found for the idea:
${papersFor(c.topic)
  .map((p) => `- ${p.title} (${p.year})`)
  .join('\n')}`,
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
          `Chapter: ${c.topic.chapter.title}. ${c.topic.chapter.scopeNote}`,
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
  const candidatePath = join(here, 'candidates', `${name}.md`);
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
  const cases = casesFor(name).filter((c) => !only || c.id.includes(only));

  const rows: Array<Record<string, unknown>> = [];
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  const scores = { a: 0, b: 0 };
  const stats = { a: { empty: 0, cited: 0, dropped: 0 }, b: { empty: 0, cited: 0, dropped: 0 } };
  let n = 0;
  const timing = { a: [] as number[], b: [] as number[] };

  for (const c of cases) {
    for (let s = 0; s < samples; s++) {
      overridePrompt(name, null);
      const startA = Date.now();
      const a = await safely(llm, c, 'current');
      timing.a.push(Date.now() - startA);
      overridePrompt(name, candidate);
      const startB = Date.now();
      const b = await safely(llmB, c, 'candidate');
      timing.b.push(Date.now() - startB);
      overridePrompt(name, null);

      const j1 = await steadyJudge(llm, c, a.shown, b.shown);
      const j2 = await steadyJudge(llm, c, b.shown, a.shown);
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
        if (o.empty) stats[k].empty++;
        if (o.cited > 0) stats[k].cited++;
        stats[k].dropped += o.dropped;
      }
      n++;
      rows.push({
        case: c.id,
        sample: s,
        verdict,
        a: a.shown,
        b: b.shown,
        aRaw: a.raw,
        bRaw: b.raw,
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
    medianMs: { current: median(timing.a), candidate: median(timing.b) },
    ...(modelB ? { models: { current: env.AI_FAST_MODEL, candidate: modelB } } : {}),
    spentRupees: +(meter.rupees() + (modelB ? meterB.rupees() : 0)).toFixed(2),
  };
  console.log(JSON.stringify(summary, null, 2));
  mkdirSync(join(here, 'results'), { recursive: true });
  writeFileSync(
    join(
      here,
      'results',
      `${name}${modelB ? `-vs-${modelB}` : ''}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`,
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
