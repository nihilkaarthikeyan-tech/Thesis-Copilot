/**
 * Real-provider shakedown — every structured-output path, against the configured models.
 *
 * `pnpm ai:verify` proves the *streaming* path: one short continuation per tier. Thirteen product
 * call sites use `complete()` instead, which is `generateObject` — the model must return JSON that
 * satisfies a Zod schema, inside a per-action `maxTokens` cap. None of them had ever run against a
 * real model; every one had only ever met the mock, which returns well-formed objects by
 * construction because that is what it was written to do.
 *
 * That is the same shape as the defect ADR-0011's predecessor found: the Anthropic adapter put its
 * system blocks in the wrong place for the whole build and nothing noticed, because nothing real
 * ever called it.
 *
 * The specific worry this script exists to settle: `gpt-5-mini` reasons before it answers, and
 * reasoning tokens are billed as output and drawn from the same `maxOutputTokens` budget. The fast
 * tier turns reasoning off (`reasoningEffort: 'minimal'`, see `providers/openai.ts`) because a
 * 120-token cap leaves no room for it. The strong tier deliberately leaves it on. Several strong
 * calls here run under caps of 400–900 tokens. If the model spends them reasoning, `generateObject`
 * gets nothing to parse and the action fails in production.
 *
 * Inputs below are plausible fixtures written for this script. They are not test expectations and
 * nothing is asserted about the model's *answer* — only that a well-formed request produces a
 * schema-valid object inside its cap. §0.3 rule 2 is about fabricated expectations; there are none
 * here.
 *
 *   pnpm --filter @tc/ai shakedown            # every case
 *   pnpm --filter @tc/ai shakedown outline    # only cases whose name contains "outline"
 */

import { computeCallCost, loadEnv, microToInr } from '@tc/config';
import { paperExtractionSchema } from '@tc/types';
import type { z } from 'zod';
import { createProviders } from '../src/factory.js';
import {
  buildCiteParseRequest,
  buildCiteRequest,
  buildCiteRoleRequest,
  buildClaimsRequest,
  buildClassifyRequest,
  buildCommandRequest,
  buildContradictionRequest,
  buildCrossPaperRequest,
  buildDraftRequest,
  buildExtractionRequest,
  buildOutlineDriftRequest,
  buildOutlineRequest,
  buildProposalRequest,
  buildQueriesRequest,
  buildSectionScopeRequest,
  buildStyleRequest,
  buildTermDriftRequest,
  buildThemesRequest,
  buildUnsupportedRequest,
  citeResultSchema,
  claimsSchema,
  classifySchema,
  commandResultSchema,
  contradictionSchema,
  crossPaperSchema,
  draftResultSchema,
  outlineDriftSchema,
  outlineRequestSchema,
  parsedCitationSchema,
  parseProposalReply,
  postProcessDraft,
  queriesSchema,
  sectionScopeSchema,
  styleProfileSchema,
  termDriftSchema,
  themesSchema,
  unsupportedSchema,
} from '../src/index.js';
import { REASONING_HEADROOM } from '../src/providers/openai.js';
import type { LlmProvider, LlmRequest } from '../src/types.js';

const env = loadEnv();
const llm: LlmProvider = createProviders(env).llm;

const USER = 'shakedown';
const DOC = 'shakedown-doc';

// --------------------------------------------------------------------------------------------
// Inputs. One coherent imaginary thesis, so every prompt reads like a real one rather than lorem.
// --------------------------------------------------------------------------------------------

const SCOPE = {
  workingTitle: 'Barriers to rooftop solar adoption in rural Karnataka',
  problemStatement:
    'Household uptake of rooftop solar in rural Karnataka remains below 4% despite panel prices falling by more than half since 2018 and a state subsidy covering up to 40% of installation cost.',
  objectives: [
    'Identify the financial, informational and infrastructural barriers households report',
    'Assess whether prior experience of a government subsidy scheme changes adoption behaviour',
    'Compare stated barriers against installer-side accounts of why enquiries do not convert',
  ],
  whyOpen:
    'Existing work prices the technology and models the grid, but little of it asks households in non-metro districts what actually stopped them.',
};

const PASSAGES = [
  {
    id: 'S1#c1',
    shortRef: 'Kumar 2021',
    page: 4,
    text: 'Across 412 households in rural Karnataka, upfront capital cost was cited as the primary barrier to solar adoption by 68% of non-adopters, ahead of maintenance concerns (19%) and roof suitability (13%). Households with prior experience of a government subsidy scheme were 2.3 times more likely to adopt.',
  },
  {
    id: 'S2#c1',
    shortRef: 'Devi and Rao 2022',
    page: 11,
    text: 'Interviews in three Karnataka districts found that trust in installer quality, rather than price alone, determined whether a household proceeded after an initial enquiry. Respondents repeatedly cited the absence of a local service presence as the reason they did not proceed.',
  },
  {
    id: 'S3#c2',
    shortRef: 'Narayan 2020',
    page: 7,
    text: 'Subsidy disbursement in the state averaged 14 weeks from application to payment over the 2018-2020 period. Installers reported that the delay, rather than the subsidy amount, was what households objected to most often.',
  },
];

const MEMORY =
  '<document_memory>' +
  `<title>${SCOPE.workingTitle}</title>` +
  '<question>Why does household adoption remain low despite falling panel prices?</question>' +
  '<chapter title="Barriers to adoption">What stops households adopting, and why.</chapter>' +
  '</document_memory>';

const CHAPTER_TEXT = [
  'Several factors constrain household uptake of rooftop solar in rural Karnataka.',
  'Cost is the most frequently cited barrier, and it is the one policy has addressed most directly.',
  'The state subsidy covers up to 40% of installation, which should in principle close most of the gap.',
  'Yet adoption has not moved in proportion, which suggests cost is not the only constraint operating.',
  'Trust in installer quality appears to matter at least as much as price.',
  'Households in districts without a local service presence proceed far less often after an enquiry.',
  'Subsidy disbursement delays of around fourteen weeks compound the problem.',
  'A household that must finance the full amount for three months is, in effect, unsubsidised.',
  'Solar adoption is therefore better understood as a trust and liquidity problem than a price problem.',
].join(' ');

const HUMAN_SAMPLE = `${CHAPTER_TEXT} ${CHAPTER_TEXT}`;

const EXTRACTION = {
  title: 'Household barriers to rooftop solar in rural Karnataka: a survey of 412 households',
  abstract:
    'We survey 412 households across six rural districts of Karnataka to identify the barriers to rooftop solar adoption that households themselves report, and test whether prior subsidy experience predicts adoption.',
  objectives: [
    'Identify which barriers rural households report as decisive against rooftop solar adoption',
    'Test whether prior experience of a government subsidy scheme predicts adoption',
  ],
  methodology:
    'Cross-sectional household survey (n=412) across six districts, stratified by district and grid reliability band, with logistic regression on adoption status.',
  findings: [
    {
      claim: 'Upfront capital cost was the primary reported barrier for non-adopters.',
      evidence:
        'Cited by 68% of non-adopters, ahead of maintenance (19%) and roof suitability (13%).',
    },
    {
      claim: 'Prior experience of a government subsidy scheme predicts adoption.',
      evidence: 'Odds ratio 2.3 (Table 4).',
    },
  ],
  terminology: [
    {
      term: 'adoption',
      definition: 'A household has installed and commissioned a rooftop solar system.',
      usageNote: 'Excludes households that received a quote but did not install.',
    },
  ],
  references: [
    {
      raw: 'Narayan, A. (2020). Subsidy disbursement and household energy investment. Renewable Energy, 155, 1201-1210.',
      doi: '',
    },
  ],
  sections: [
    {
      heading: 'Introduction',
      summary: 'Capacity grew twelvefold since 2014 but household uptake stays below 4%.',
    },
    { heading: 'Method', summary: 'Stratified cross-sectional survey across six districts.' },
    {
      heading: 'Results',
      summary: 'Cost dominates reported barriers; prior subsidy experience predicts adoption.',
    },
    { heading: 'Limitations', summary: 'Single state, cross-sectional, no installer-side data.' },
  ],
};

const EXTRACTION_2 = {
  ...EXTRACTION,
  title: 'Why enquiries do not convert: installer accounts of rooftop solar in Karnataka',
  abstract:
    'Interviews with households and installers in three Karnataka districts, examining why initial enquiries about rooftop solar do not convert into installations.',
  objectives: [
    'Explain why rooftop solar enquiries in Karnataka fail to convert into installations',
  ],
  methodology:
    'Semi-structured interviews with 38 households and 11 installers across three districts, coded thematically.',
  findings: [
    {
      claim:
        'Trust in installer quality, not price, decided whether a household proceeded after enquiry.',
      evidence: 'Raised unprompted in 31 of 38 household interviews.',
    },
    {
      claim: 'Absence of a local service presence was the most common reason for not proceeding.',
      evidence: 'Cited in all three districts without a resident installer.',
    },
  ],
  terminology: [
    {
      term: 'adoption',
      definition: 'A household has signed an installation contract.',
      usageNote:
        'Counted at contract signing, not commissioning - deliberately earlier than Kumar 2021.',
    },
  ],
};

// --------------------------------------------------------------------------------------------

type Case = {
  readonly name: string;
  readonly site: string;
  readonly request: Omit<LlmRequest, 'schema'>;
  readonly schema?: z.ZodType<unknown>;
  /**
   * A streamed path. The product streams text and then makes sense of it in code — it never asks
   * the model for JSON — so the case supplies the product's own reader. Returning a string is a
   * failure with that reason; returning nothing is a pass.
   */
  readonly readStream?: (raw: string) => string | null;
};

const cases: Case[] = [
  {
    name: 'cite — citation suggestion',
    site: 'apps/api/.../assist/cite.service.ts:122',
    request: buildCiteRequest({
      memoryBlock: MEMORY,
      sentence:
        'Households in districts without a local service presence proceed far less often after an enquiry.',
      passages: PASSAGES,
      userId: USER,
      documentId: DOC,
    }),
    schema: citeResultSchema,
  },
  {
    name: 'cite-parse — a pasted reference into CSL',
    site: 'apps/api/.../chapters/cite-parse.service.ts:126',
    request: buildCiteParseRequest({
      reference:
        'Kumar, R., & Shetty, P. (2021). Household barriers to rooftop solar in rural Karnataka: a survey of 412 households. Energy Policy, 158, 112345. https://doi.org/10.1016/j.enpol.2021.112345',
      userId: USER,
      documentId: DOC,
    }),
    schema: parsedCitationSchema,
  },
  {
    name: 'command — tighten a selection',
    site: 'apps/api/.../assist/command.service.ts:119',
    request: buildCommandRequest({
      command: 'shorten',
      memoryBlock: MEMORY,
      selection:
        'It is worth noting that, in a number of cases, it would appear that the question of trust in the quality of the installer may well be a factor that is at least as important as the price itself.',
      contextBefore: 'Cost is the most frequently cited barrier. ',
      contextAfter: ' Subsidy disbursement delays compound the problem.',
      passages: PASSAGES,
      userId: USER,
      documentId: DOC,
    }),
    schema: commandResultSchema,
  },
  {
    name: 'cite-role — move a citation to a different role',
    site: 'apps/api/.../assist/cite-role.service.ts:105',
    request: buildCiteRoleRequest({
      sentence:
        'Trust in installer quality determines whether a household proceeds after an enquiry {{cite:S2#c1}}.',
      citationId: 'S2#c1',
      targetRole: 'narrative',
      memoryBlock: MEMORY,
      userId: USER,
      documentId: DOC,
    }),
    schema: commandResultSchema,
  },
  {
    name: 'classify — a guide comment',
    site: 'apps/api/.../feedback/comments.service.ts:153',
    request: buildClassifyRequest({
      chapterTitle: 'Barriers to adoption',
      comment:
        'This paragraph asserts that delay matters more than amount, but you have not shown it. Either cite the disbursement figure or soften the claim.',
      userId: USER,
      documentId: DOC,
    }),
    schema: classifySchema,
  },
  {
    name: 'section-scope — regenerate one chapter scope note',
    site: 'apps/api/.../memory/outline.service.ts:303',
    request: buildSectionScopeRequest({
      scope: SCOPE,
      node: {
        id: 'n3',
        title: 'Methodology',
        scopeNote: 'Design, sampling, instruments.',
        role: 'METHODOLOGY',
      },
      siblings: [
        {
          title: 'Literature Review',
          scopeNote: 'What is known and what is not.',
          position: 'before',
        },
        { title: 'Results', scopeNote: 'What the data shows.', position: 'after' },
      ],
      instruction: 'Say explicitly that this is a mixed-methods design.',
      userId: USER,
      documentId: DOC,
    }),
    schema: sectionScopeSchema,
  },
  {
    name: 'style — build the style profile',
    site: 'apps/api/.../memory/style.service.ts:74',
    request: buildStyleRequest({ sample: HUMAN_SAMPLE, userId: USER, documentId: DOC }),
    schema: styleProfileSchema,
  },
  {
    name: 'outline — generate the whole chapter tree',
    site: 'apps/worker/.../generate-outline.ts:118',
    request: buildOutlineRequest({
      template: 'QUALITATIVE',
      scope: SCOPE,
      userId: USER,
      documentId: DOC,
    }),
    schema: outlineRequestSchema,
  },
  {
    name: 'cross-paper — contradictions between seed papers',
    site: 'apps/worker/.../cross-paper.ts:81',
    request: buildCrossPaperRequest({
      papers: [
        { id: 'p1', title: EXTRACTION.title, extraction: EXTRACTION as never },
        { id: 'p2', title: EXTRACTION_2.title, extraction: EXTRACTION_2 as never },
      ],
      userId: USER,
      documentId: DOC,
    }),
    schema: crossPaperSchema,
  },
  {
    name: 'queries — literature search terms',
    site: 'apps/worker/.../search-literature.ts:269',
    request: buildQueriesRequest({
      scope: SCOPE,
      existingTitles: [EXTRACTION.title, EXTRACTION_2.title],
      userId: USER,
      documentId: DOC,
    }),
    schema: queriesSchema,
  },
  {
    name: 'themes — group results into the gap map',
    site: 'apps/worker/.../search-literature.ts:343',
    request: buildThemesRequest({
      scope: SCOPE,
      candidates: [
        { id: 'w1', title: EXTRACTION.title, abstract: EXTRACTION.abstract },
        { id: 'w2', title: EXTRACTION_2.title, abstract: EXTRACTION_2.abstract },
        {
          id: 'w3',
          title: 'Subsidy disbursement delay and household energy investment in South India',
          abstract:
            'We examine how the lag between subsidy application and payment affects household willingness to invest in distributed solar.',
        },
        {
          id: 'w4',
          title: 'Grid reliability and distributed generation uptake in Indian villages',
          abstract:
            'A panel study of outage frequency against rooftop solar installations across 240 villages.',
        },
      ],
      userId: USER,
      documentId: DOC,
    }),
    schema: themesSchema,
  },
  {
    name: 'coherence/term-drift',
    site: 'apps/worker/.../coherence-run.ts:850',
    request: buildTermDriftRequest({
      term: 'adoption',
      definition: 'A household has installed and commissioned a rooftop solar system.',
      sentences: [
        {
          id: 's1',
          chapter: 'Introduction',
          sentence: 'Adoption remains below 4% across the state.',
        },
        {
          id: 's2',
          chapter: 'Barriers to adoption',
          sentence: 'We count a household as an adopter once it has enquired and received a quote.',
        },
        {
          id: 's3',
          chapter: 'Results',
          sentence: 'Adoption rose fastest in districts with a local installer presence.',
        },
      ],
      userId: USER,
      documentId: DOC,
    }),
    schema: termDriftSchema,
  },
  {
    name: 'coherence/claims — extract claims from a chapter',
    site: 'apps/worker/.../coherence-run.ts:850',
    request: buildClaimsRequest({
      chapterTitle: 'Barriers to adoption',
      chapterText: CHAPTER_TEXT,
      userId: USER,
      documentId: DOC,
    }),
    schema: claimsSchema,
  },
  {
    name: 'coherence/contradiction — claims against passages',
    site: 'apps/worker/.../coherence-run.ts:850',
    request: buildContradictionRequest({
      claims: [
        {
          id: 'c1',
          text: 'Subsidy disbursement delays of around fourteen weeks compound the problem.',
          passages: [
            { id: 'S3#c2', chapter: 'Barriers to adoption', text: PASSAGES[2]?.text ?? '' },
            { id: 'S1#c1', chapter: 'Barriers to adoption', text: PASSAGES[0]?.text ?? '' },
          ],
        },
        {
          id: 'c2',
          text: 'Cost is the only meaningful barrier to household adoption.',
          passages: [
            { id: 'S2#c1', chapter: 'Barriers to adoption', text: PASSAGES[1]?.text ?? '' },
          ],
        },
      ],
      userId: USER,
      documentId: DOC,
    }),
    schema: contradictionSchema,
  },
  {
    name: 'coherence/unsupported — sentences needing a citation',
    site: 'apps/worker/.../coherence-run.ts:850',
    request: buildUnsupportedRequest({
      sentences: [
        { id: 's1', text: 'Adoption remains below 4% across the state.' },
        {
          id: 's2',
          text: 'Solar adoption is better understood as a trust problem than a price problem.',
        },
        {
          id: 's3',
          text: 'This chapter sets out what the survey found {{cite:S1#c1}}.',
        },
      ],
      chapterRole: 'DISCUSSION',
      userId: USER,
      documentId: DOC,
    }),
    schema: unsupportedSchema,
  },
  {
    name: 'coherence/outline-drift',
    site: 'apps/worker/.../coherence-run.ts:850',
    request: buildOutlineDriftRequest({
      scopeNote: 'What stops households adopting, and why.',
      summary:
        'The chapter covers cost as a barrier, the state subsidy and its coverage, trust in installer quality, local service presence, and subsidy disbursement delay. It closes by reframing adoption as a trust and liquidity problem. It also spends two paragraphs on grid reliability, which the scope note does not mention.',
      userId: USER,
      documentId: DOC,
    }),
    schema: outlineDriftSchema,
  },
  {
    name: 'extraction — read an uploaded paper',
    site: 'packages/ai/src/extraction.ts:237',
    request: buildExtractionRequest({
      userId: USER,
      documentId: DOC,
      filename: 'kumar-2021.pdf',
      partText: [
        'Household barriers to rooftop solar in rural Karnataka: a survey of 412 households',
        'R. Kumar, P. Shetty. Energy Policy 158 (2021) 112345. https://doi.org/10.1016/j.enpol.2021.112345',
        '',
        'Abstract. We survey 412 households across six rural districts of Karnataka to identify the barriers',
        'to rooftop solar adoption that households themselves report, and test whether prior subsidy',
        'experience predicts adoption.',
        '',
        '1. Introduction. Rooftop solar capacity in Karnataka has grown twelvefold since 2014, but almost',
        'all of that growth is commercial. Household uptake remains below 4%.',
        '',
        '2. Method. Cross-sectional household survey (n=412) across six districts, stratified by district',
        'and by grid reliability band. Adoption status was regressed on reported barriers and on prior',
        'experience of any government subsidy scheme.',
        '',
        '3. Results. Upfront capital cost was cited as the primary barrier by 68% of non-adopters, ahead of',
        'maintenance concerns (19%) and roof suitability (13%). Households with prior experience of a',
        'government subsidy scheme were 2.3 times more likely to adopt.',
        '',
        '4. Limitations. Single state, cross-sectional, and no installer-side data.',
      ].join('\n'),
    }),
    schema: paperExtractionSchema,
  },
  // --- stream-then-parse. Not `complete()`, but the model still has to produce parseable JSON. ---
  {
    name: 'proposal — a turn in the topic conversation',
    site: 'apps/api/.../documents/proposal.service.ts (streamed, then parseProposalReply)',
    request: buildProposalRequest({
      history: [
        {
          role: 'user',
          text: 'I want to work on why rural households in Karnataka are not adopting rooftop solar.',
        },
        { role: 'assistant', text: 'What makes you think price is not the whole story?' },
        {
          role: 'user',
          text: 'Panel prices halved since 2018 and there is a 40% state subsidy, but uptake is still under 4%. Installers I spoke to say people drop out after the first quote.',
        },
      ],
      constraints: 'M.Tech dissertation, 18,000 words, submission in six months.',
      userId: USER,
      documentId: DOC,
    }),
    // A.6 lets the model ask up to three questions before it produces the skeleton, so a question
    // here is the right answer and not a failure. What must never happen is `invalid` — a
    // `<skeleton>` block that is not JSON, or is JSON the schema refuses.
    readStream: (raw) => {
      const reply = parseProposalReply(raw);
      return reply.kind === 'invalid' ? `skeleton came back unusable: ${reply.reason}` : null;
    },
  },
  {
    name: 'draft — draft a section',
    site: 'apps/worker/.../draft-section.ts:203 (streamed markdown, then postProcessDraft)',
    request: buildDraftRequest({
      memoryBlock: MEMORY,
      section: {
        outlineNodeId: 'n2',
        title: 'Barriers to adoption',
        scopeNote: 'What stops households adopting, and why.',
        children: [
          {
            title: 'Cost and subsidy',
            scopeNote: 'Capital cost, the state subsidy, and its coverage.',
          },
          { title: 'Trust and service presence', scopeNote: 'Why enquiries do not convert.' },
        ],
      },
      passages: PASSAGES,
      tier: 'strong',
      userId: USER,
      documentId: DOC,
    }),
    // Draft streams markdown; `draftResultSchema` describes what the *post-processor* builds from
    // it, not what the model says. So this runs the post-processor and checks its output, which
    // is what `draft-section.ts` stores.
    readStream: (raw) => {
      const processed = postProcessDraft(raw, PASSAGES, 300);
      const result = draftResultSchema.safeParse(processed.result);
      if (!result.success) {
        return `post-processed draft does not match DraftResult: ${result.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ')}`;
      }
      if (processed.result.words === 0) return 'the model produced no prose';
      if (processed.hallucinated.length > 0) {
        return `invented citations that were stripped: ${processed.hallucinated.join(', ')}`;
      }
      return null;
    },
  },
];

// --------------------------------------------------------------------------------------------

type Outcome = {
  readonly name: string;
  readonly site: string;
  readonly tier: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly ms: number;
  readonly costMicroInr: number;
  readonly outputTokens: number;
  readonly maxTokens: number;
};

/**
 * What the adapter actually asks the provider for: the action's answer budget plus the reasoning
 * headroom it adds on a reasoning model. Reported rather than `maxTokens` alone, because
 * `usage.outputTokens` counts reasoning too — against the bare cap every strong call looks like it
 * overran when it did not.
 */
function budgetFor(maxTokens: number): number {
  return maxTokens + REASONING_HEADROOM;
}

function preview(value: unknown, max = 150): string {
  const s = JSON.stringify(value) ?? String(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

async function runStreamed(
  c: Case,
): Promise<Omit<Outcome, 'name' | 'site' | 'tier' | 'maxTokens'>> {
  const started = Date.now();
  let raw = '';
  let usage = { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
  let finishReason = '';

  for await (const chunk of llm.stream(c.request as LlmRequest)) {
    if (chunk.type === 'text') raw += chunk.text;
    else {
      usage = chunk.usage as typeof usage;
      finishReason = chunk.finishReason;
    }
  }
  const ms = Date.now() - started;
  const cost = computeCallCost({
    tier: c.request.tier,
    modelId: llm.modelIdFor(c.request.tier),
    usage,
  });

  const complaint = c.readStream?.(raw) ?? null;
  if (complaint === null) {
    return {
      ok: true,
      detail: preview(raw.trim(), 120),
      ms,
      costMicroInr: cost,
      outputTokens: usage.outputTokens,
    };
  }
  return {
    ok: false,
    detail:
      raw.trim() === ''
        ? `nothing came back (finish: ${finishReason}, ${usage.outputTokens} output tokens billed)`
        : `${complaint}
       got: ${preview(raw.trim(), 200)}`,
    ms,
    costMicroInr: cost,
    outputTokens: usage.outputTokens,
  };
}

async function runStructured(
  c: Case,
): Promise<Omit<Outcome, 'name' | 'site' | 'tier' | 'maxTokens'>> {
  const started = Date.now();
  try {
    const result = await llm.complete({
      ...(c.request as LlmRequest),
      schema: c.schema as z.ZodType<unknown>,
    });
    const ms = Date.now() - started;
    return {
      ok: true,
      detail: preview(result.value),
      ms,
      costMicroInr: computeCallCost({
        tier: c.request.tier,
        modelId: result.modelId,
        usage: result.usage,
      }),
      outputTokens: result.usage.outputTokens,
    };
  } catch (cause) {
    const ms = Date.now() - started;
    const err = cause as {
      name?: string;
      message?: string;
      raw?: string;
      issues?: unknown;
      cause?: { message?: string; text?: string; usage?: { outputTokens?: number } };
    };
    const inner = err.cause?.message ? ` <- ${err.cause.message}` : '';
    // A validation failure is only useful if you can see what came back. `raw` is what the
    // adapter caught; on AI_NoObjectGeneratedError the text and usage hang off the cause.
    const got = err.raw ?? err.cause?.text ?? '';
    const billed = err.cause?.usage?.outputTokens ?? 0;
    const shown =
      got.trim() === ''
        ? `(nothing came back; ${billed} output tokens billed — reasoning, most likely)`
        : `got: ${preview(got, 260)}`;
    return {
      ok: false,
      detail: `${err.name ?? 'Error'}: ${(err.message ?? String(cause)).slice(0, 200)}${inner.slice(0, 200)}
       ${shown}`,
      ms,
      costMicroInr: 0,
      outputTokens: billed,
    };
  }
}

async function main(): Promise<void> {
  const filter = process.argv[2]?.toLowerCase();
  const selected = filter ? cases.filter((c) => c.name.toLowerCase().includes(filter)) : cases;

  if (selected.length === 0) {
    console.error(`No case matches "${filter}". Names:`);
    for (const c of cases) console.error(`  ${c.name}`);
    process.exit(2);
  }

  console.log('');
  console.log('='.repeat(100));
  console.log('Structured-output shakedown — every path that needs the model to return JSON');
  console.log('='.repeat(100));
  console.log(`fast   ${llm.modelIdFor('fast')}`);
  console.log(`strong ${llm.modelIdFor('strong')}`);
  console.log(`cases  ${selected.length}${filter ? ` (filtered by "${filter}")` : ''}`);
  console.log('');

  const results: Outcome[] = [];
  for (const c of selected) {
    process.stdout.write(`  ${c.name.padEnd(52)} `);
    const r = c.readStream ? await runStreamed(c) : await runStructured(c);
    const out: Outcome = {
      name: c.name,
      site: c.site,
      tier: c.request.tier,
      maxTokens: c.request.maxTokens,
      ...r,
    };
    results.push(out);
    console.log(
      `${out.ok ? 'ok  ' : 'FAIL'}  ${String(out.ms).padStart(6)} ms  ` +
        `out ${String(out.outputTokens).padStart(5)}/${budgetFor(out.maxTokens)}  ` +
        `INR ${microToInr(out.costMicroInr).toFixed(4)}`,
    );
    if (!out.ok) console.log(`       ${out.detail}`);
  }

  const failed = results.filter((r) => !r.ok);
  const totalCost = results.reduce((s, r) => s + r.costMicroInr, 0);

  console.log('');
  console.log('='.repeat(100));
  console.log(
    `${results.length - failed.length}/${results.length} passed. ` +
      `Total spend this run: INR ${microToInr(totalCost).toFixed(4)}.`,
  );

  // A call that used most of its cap is a call that is one longer input away from failing.
  const tight = results.filter((r) => r.ok && r.outputTokens > budgetFor(r.maxTokens) * 0.8);
  if (tight.length > 0) {
    console.log('');
    console.log('Near the cap (>80% of maxTokens used) — these pass today and may not tomorrow:');
    for (const r of tight) {
      console.log(`  ${r.name.padEnd(52)} ${r.outputTokens}/${budgetFor(r.maxTokens)}`);
    }
  }

  if (failed.length > 0) {
    console.log('');
    console.log('Failures:');
    for (const r of failed) {
      console.log(`  ${r.name}`);
      console.log(`    ${r.site}`);
      console.log(`    tier=${r.tier} maxTokens=${r.maxTokens}`);
      console.log(`    ${r.detail}`);
    }
    console.log('='.repeat(100));
    process.exit(1);
  }

  console.log('='.repeat(100));
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
