/**
 * Writing guidance per research paradigm — ADR-0047.
 *
 * Rademics Copilot's methodology writer branches by research type: engineering, qualitative, law
 * (statutory corpus, case law), humanities (hermeneutic validity), simulation. The useful part is
 * not the branching itself — our Method blueprint already branches — but what each branch tells
 * the writer: what counts as evidence in that kind of research, which validity vocabulary an
 * examiner expects, and what reads as a mistake. That is data, so it lives here beside the
 * blueprints, and it reaches the writer through the section's scope note, never by editing a
 * prompt (§0.3 rule 6).
 *
 * Every line is phrased under the grounding rules: guidance on *how* to write what the passages
 * support, never an invitation to supply what they do not.
 */

import type { DisciplineProfile, Paradigm } from './types.js';

export type ParadigmGuidance = {
  /** What counts as evidence in this kind of research, and how it is cited. */
  readonly evidence: string;
  /** The validity vocabulary an examiner looks for in the Methodology. */
  readonly validity: string;
  /** Register and form. */
  readonly register: string;
  /** What reads as a mistake to an examiner in this paradigm. */
  readonly avoid: readonly string[];
};

export const PARADIGM_GUIDANCE: Readonly<Record<Paradigm, ParadigmGuidance>> = {
  experimental: {
    evidence:
      'Evidence is measured results: name the material, the condition and the value together, with its unit, as the passage gives them.',
    validity:
      'Speak of repeatability, replication, calibration, test standards and measurement uncertainty.',
    register: 'Past tense for what was done; present tense for what is established.',
    avoid: [
      'a value without its unit or test condition',
      'a result from one material written as if it held for another',
      'causal claims a single experiment cannot carry',
    ],
  },
  quantitative: {
    evidence:
      'Evidence is statistical: report the statistic, the sample and the significance or interval exactly as the passage states them.',
    validity:
      'Speak of sampling, reliability (for example Cronbach’s alpha), construct validity, generalisability and effect size.',
    register: 'Hypotheses and variables named consistently; past tense for findings.',
    avoid: [
      'correlation written as causation',
      'significance reported without the test or the sample',
      'a finding generalised beyond the population sampled',
    ],
  },
  qualitative: {
    evidence:
      'Evidence is participants’ accounts and the themes drawn from them; attribute interpretations to their source rather than stating them as facts.',
    validity:
      'Speak of trustworthiness — credibility, transferability, dependability, confirmability — and reflexivity, not of reliability coefficients or statistical generalisation.',
    register:
      'First person is acceptable for the researcher’s position where the university allows it.',
    avoid: [
      'claims of representativeness or statistical generalisation',
      'counting themes as if frequency were the finding',
      'interpretation presented as the participants’ own words',
    ],
  },
  mixed: {
    evidence:
      'Keep the quantitative and the qualitative strands distinct and say where and how they are integrated.',
    validity:
      'Speak of each strand’s validity in its own terms, then of the integration: triangulation, complementarity, meta-inferences.',
    register: 'Name the design (convergent, explanatory sequential, exploratory sequential).',
    avoid: ['one strand judged by the other’s standards', 'integration claimed but not shown'],
  },
  computational: {
    evidence:
      'Evidence is reported performance: the metric, the dataset, the baseline and the setting together, as the passage reports them.',
    validity:
      'Speak of reproducibility, train/test separation, baselines, ablations and statistical comparison across runs.',
    register: 'Define every metric and symbol before it is used; equations in LaTeX.',
    avoid: [
      'a score without its dataset or baseline',
      'results on different datasets compared as if equal',
      'state-of-the-art claimed beyond what the passages report',
    ],
  },
  simulation: {
    evidence:
      'Evidence is model output and its validation: state the model, the conditions it was run under and what it was validated against, as the passages give them.',
    validity:
      'Speak of verification (the equations are solved right), validation (the right equations — agreement with experiment), mesh or time-step independence, and sensitivity to assumptions.',
    register:
      'Governing equations in LaTeX with every symbol defined; assumptions listed before results.',
    avoid: [
      'simulated values written as measured ones',
      'a model presented without its boundary conditions or validation',
      'precision beyond the model’s validated range',
    ],
  },
  design_build: {
    evidence:
      'Evidence is the built artefact and its evaluation against stated requirements: requirement, test and result together.',
    validity:
      'Speak of requirements traceability, test coverage, benchmarks and user evaluation where it was done.',
    register: 'Requirements numbered and referred to by number.',
    avoid: [
      'features listed without the requirement they meet',
      'evaluation claims without a test',
    ],
  },
  theoretical: {
    evidence:
      'Evidence is argument from established results: cite the theorem, model or framework each step rests on.',
    validity: 'Speak of assumptions, scope conditions, internal consistency and proof.',
    register: 'Definitions before use; each claim marked as assumed, derived or cited.',
    avoid: ['an assumption used as if proved', 'a derivation step left unexplained'],
  },
  doctrinal: {
    evidence:
      'Evidence is the law itself: statutes by name, section and year; cases by name, citation and court; the holding distinguished from obiter — only as the passages give them.',
    validity:
      'Speak of authority and its weight (binding or persuasive, court hierarchy, jurisdiction), currency of the law, and the interpretive method (textual, purposive, comparative).',
    register: 'Formal legal register; jurisdiction named before the law is discussed.',
    avoid: [
      'a case or statute not in the passages',
      'a dissent or obiter dictum presented as the ratio',
      'law of one jurisdiction applied to another without saying so',
      'an overruled or amended provision stated as current',
    ],
  },
  textual: {
    evidence:
      'Evidence is the text: quote or closely paraphrase the primary text with its edition and location, and attribute each critical reading to its critic.',
    validity:
      'Speak of interpretive (hermeneutic) validity: coherence of the reading with the whole text, attention to context, engagement with rival readings, and the limits of the theoretical lens.',
    register:
      'Present tense for what a text does; the critic’s argument distinguished from the student’s.',
    avoid: [
      'an interpretation stated as a fact about the text',
      'a critic’s view presented as the student’s own',
      'a quotation without its edition or location',
    ],
  },
  clinical: {
    evidence:
      'Evidence is trial and cohort data: the population, the intervention and comparator, the outcome and its effect size with confidence interval, as the passage reports them.',
    validity:
      'Speak of study design and level of evidence, randomisation and blinding, bias, confounding, and the reporting guideline followed (CONSORT, STROBE, PRISMA).',
    register: 'Person-first language; drug names generic.',
    avoid: [
      'an association written as an effect',
      'a surrogate outcome presented as a clinical one',
      'a superseded guideline stated as current',
    ],
  },
};

/** Method-type section titles: these get the full paradigm guidance; others the evidence line. */
const METHOD_TITLE =
  /\b(method|methodology|methods|materials|procedure|research design|approach|experimental (set-?up|design)|simulation|numerical model|data collection|analysis plan)\b/i;

export function isMethodSection(title: string): boolean {
  return METHOD_TITLE.test(title);
}

/**
 * The lines a section's scope note carries for this discipline and paradigm. A method section gets
 * evidence, validity, register and the mistakes to avoid; any other section gets the evidence line
 * and the mistakes, which is what keeps a Literature Review in law citing law and a Discussion in
 * qualitative research from generalising. Returns the empty string for nothing to add.
 */
export function writingGuidance(
  discipline: Pick<DisciplineProfile, 'displayName'>,
  paradigm: Paradigm,
  sectionTitle: string,
): string {
  const g = PARADIGM_GUIDANCE[paradigm];
  const lines = [`Research type: ${paradigm.replace(/_/g, ' ')} (${discipline.displayName}).`];
  lines.push(g.evidence);
  if (isMethodSection(sectionTitle)) {
    lines.push(g.validity);
    lines.push(g.register);
  }
  lines.push(`Avoid: ${g.avoid.join('; ')}.`);
  lines.push('Write only what the passages support; this guidance is about form, not content.');
  return lines.join('\n');
}
