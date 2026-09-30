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
import { z } from 'zod';
import { buildAssistRequest, type PromptPassage } from '../src/builder/assist.js';
import { buildChatRequest, postProcessChat } from '../src/builder/chat.js';
import {
  buildCommandRequest,
  commandResultSchema,
  postProcessCommand,
} from '../src/builder/command.js';
import { buildDraftRequest, postProcessDraft } from '../src/builder/draft.js';
import { buildMemoryBlock } from '../src/builder/memory.js';
import { postProcessAssist } from '../src/builder/postprocess.js';
import { createProviders } from '../src/factory.js';
import { overridePrompt, type PromptName } from '../src/prompts.js';
import type { LlmProvider, LlmRequest } from '../src/types.js';
import { TOPICS, type Topic } from './topics.js';

const here = dirname(fileURLToPath(import.meta.url));

type Paper = {
  doi: string | null;
  title: string;
  year: number | null;
  authors: string[];
  venue: string | null;
  abstract: string;
};

function papersFor(topic: Topic): Paper[] {
  return JSON.parse(readFileSync(join(here, 'papers', `${topic.id}.json`), 'utf8')) as Paper[];
}

function shortRef(p: Paper): string {
  const last = (p.authors[0] ?? 'Anon').split(/\s+/).pop() ?? 'Anon';
  const etal =
    p.authors.length > 2
      ? ' et al.'
      : p.authors.length === 2
        ? ` & ${p.authors[1]?.split(/\s+/).pop()}`
        : '';
  return `${last}${etal} ${p.year ?? 'n.d.'}`;
}

function passagesFor(topic: Topic, count: number): PromptPassage[] {
  return papersFor(topic)
    .slice(0, count)
    .map((p, i) => ({ id: `S${i + 1}#c1`, shortRef: shortRef(p), page: null, text: p.abstract }));
}

function memoryFor(topic: Topic, chapterText: string): string {
  return buildMemoryBlock({
    scope: {
      workingTitle: topic.thesisTitle,
      problemStatement: topic.chapter.scopeNote,
      objectives: [topic.section.scopeNote],
      whyOpen: '',
    },
    outline: [
      {
        id: 'ch-review',
        title: topic.chapter.title,
        scopeNote: topic.chapter.scopeNote,
        children: [
          {
            id: 'sec-1',
            title: topic.section.title,
            scopeNote: topic.section.scopeNote,
            children: [],
          },
        ],
      },
    ],
    glossary: {},
    styleProfile: null,
    chapter: { outlineNodeId: 'ch-review', text: chapterText },
  }).text;
}

/** `{{cite:S2#c1}}` → "(Kumar et al. 2021)", as the student would read it. */
function readable(text: string, passages: readonly PromptPassage[]): string {
  return text.replace(/\{\{cite:([^}]+)\}\}/g, (_, id: string) => {
    const p = passages.find((x) => x.id === id.trim());
    return p ? `(${p.shortRef})` : '';
  });
}

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
  kind: 'assist' | 'draft' | 'chat' | 'expand' | 'formalise';
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
    }
  }
  return cases;
}

async function produce(llm: LlmProvider, c: Case): Promise<Output> {
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
  const candidatePath = join(here, 'candidates', `${name}.md`);
  if (!existsSync(candidatePath)) throw new Error(`No candidate at ${candidatePath}`);
  const candidate = readFileSync(candidatePath, 'utf8');

  const env = loadEnv();
  const llm = createProviders(env).llm;
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

  for (const c of cases) {
    for (let s = 0; s < samples; s++) {
      overridePrompt(name, null);
      const a = await safely(llm, c, 'current');
      overridePrompt(name, candidate);
      const b = await safely(llm, c, 'candidate');
      overridePrompt(name, null);

      const j1 = await judge(llm, c, a.shown, b.shown);
      const j2 = await judge(llm, c, b.shown, a.shown);
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
  };
  console.log(JSON.stringify(summary, null, 2));
  mkdirSync(join(here, 'results'), { recursive: true });
  writeFileSync(
    join(
      here,
      'results',
      `${name}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`,
    ),
    `${JSON.stringify({ summary, rows }, null, 2)}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
