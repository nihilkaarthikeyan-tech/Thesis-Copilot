/**
 * Chapter blueprints — ADR-0039, the specification's §5 "universal chapter blueprints".
 *
 * Each chapter role has required elements and paradigm variants. A chapter build instantiates
 * the blueprint for its chapter: one section per element that applies, one section per group of
 * key terms for `perEntityGroup` elements, titles adapted to the thesis. The hard rule of §5.1 —
 * every term the objectives use is introduced earlier in the chapter — is check S1, and the
 * element with `isObjectives` is where "earlier" is measured from.
 */

import type { ChapterRole } from '../templates.js';
import type { BlueprintElement, ChapterBlueprint, Paradigm } from './types.js';

const el = (
  key: string,
  title: string,
  purpose: string,
  instructions: string,
  required: BlueprintElement['required'],
  extra: Partial<BlueprintElement> = {},
): BlueprintElement => ({ key, title, purpose, instructions, required, ...extra });

const INTRODUCTION: ChapterBlueprint = {
  role: 'INTRODUCTION',
  label: 'Introduction',
  elements: [
    el(
      'intro.background',
      'Background and motivation',
      'Why the topic matters; the real-world or scholarly problem.',
      'State the real-world or scholarly problem this thesis addresses and why it matters now, citing evidence for the scale or cost of the problem. Do not describe the thesis itself yet.',
      'always',
      { targetWords: 350 },
    ),
    el(
      'intro.fundamentals',
      'Fundamentals',
      'Only the concepts the reader needs; capped by the generic-background cap.',
      'Explain, briefly, only the concepts a reader needs to follow the objectives. Define each concept before describing it. Keep this short: detail belongs in the subject-specific sections.',
      'always',
      { generic: true, targetWords: 300 },
    ),
    el(
      'intro.subject',
      'Subject-specific background',
      'One subsection per key-term group: the material, construct, population, statute or text this thesis works on.',
      'Introduce the key terms listed, one by one: what each is, why it was chosen for this thesis, and what is known about it that bears on the objectives. Every factual sentence cites a passage.',
      'always',
      { perEntityGroup: true, targetWords: 400 },
    ),
    el(
      'intro.methods_background',
      'Approach and methods background',
      'The main method, test or framework, and why it suits the problem.',
      'Introduce the main method, test or analytical framework the thesis uses, and give the reasons it suits this problem, citing prior use.',
      'always',
      { targetWords: 300 },
    ),
    el(
      'intro.problem',
      'Problem statement',
      'Concise statement of the problem.',
      'State the problem in one or two paragraphs, using only terms introduced above.',
      'always',
      { targetWords: 150, noEvidence: true },
    ),
    el(
      'intro.gap',
      'Research gap',
      'What is unresolved (the detailed version is in Chapter 2).',
      'Name what has been studied, what has not, and why that matters, in a short paragraph, each gap traced to cited work. Avoid "further research is needed".',
      'always',
      { targetWords: 200 },
    ),
    el(
      'intro.questions',
      'Research questions and hypotheses',
      'Research questions or hypotheses, as the paradigm requires.',
      'List the research questions (qualitative, textual, doctrinal) or hypotheses (quantitative, experimental, clinical) this thesis answers, each in one sentence, each using only terms introduced above.',
      'most',
      { targetWords: 150 },
    ),
    el(
      'intro.objectives',
      'Objectives',
      'The objectives, verbatim or refined with the student’s approval.',
      'List the objectives exactly as given in the document memory, as a numbered list, then one short paragraph on how they connect. Do not reword an objective.',
      'always',
      { isObjectives: true, targetWords: 150, noEvidence: true },
    ),
    el(
      'intro.scope',
      'Scope and limitations',
      'Boundaries of the study.',
      'State what the study covers and what it deliberately leaves out: materials, population, period, setting, methods.',
      'always',
      { targetWords: 200, noEvidence: true },
    ),
    el(
      'intro.significance',
      'Significance',
      'Who benefits and how.',
      'Say who benefits from the outcomes and how, with evidence for the need where a passage supports it.',
      'most',
      { targetWords: 150 },
    ),
    el(
      'intro.organisation',
      'Organisation of the thesis',
      'One or two sentences per chapter.',
      'Describe each chapter of the thesis in one or two sentences, in order, from the outline.',
      'always',
      { organisation: true, targetWords: 150, noEvidence: true },
    ),
    el(
      'intro.summary',
      'Summary',
      'Accurate recap, nothing new.',
      'Summarise what this chapter established, in one paragraph, claiming only what the chapter contains. Introduce nothing new and cite nothing new.',
      'university',
      { summary: true, targetWords: 120, noEvidence: true },
    ),
  ],
};

const LITERATURE: ChapterBlueprint = {
  role: 'LITERATURE',
  label: 'Literature review',
  elements: [
    el(
      'lit.intro',
      'Introduction to the review',
      'Scope and search strategy: databases, keywords, years, inclusion criteria.',
      'State the scope of the review and how the literature was searched: databases, keywords, years and inclusion criteria, using the sources actually in the library.',
      'always',
      { targetWords: 250 },
    ),
    el(
      'lit.theme',
      'Thematic review',
      'One section per theme; each theme synthesises, compares and critiques rather than listing paper by paper.',
      'Review the sources on this theme: what they found, how, under which conditions, where they agree and where they disagree, and what each leaves unresolved. Compare and contrast; do not summarise one paper per paragraph.',
      'always',
      { perEntityGroup: true, targetWords: 500 },
    ),
    el(
      'lit.framework',
      'Theoretical and conceptual framework',
      'Required for management, social sciences, education and humanities.',
      'Define the theory or framework this thesis works within, its origin and its main constructs, and say how it will be used to interpret the findings.',
      'framework',
      { targetWords: 400 },
    ),
    el(
      'lit.gap',
      'Critical gap analysis',
      'Specific, evidence-backed gaps, each traced to the themes above.',
      'For each gap: what has been studied, what has not, and why it matters, each traced to the cited work in the themes above. A gap must be specific enough to be closed by an objective.',
      'always',
      { targetWords: 300 },
    ),
    el(
      'lit.link',
      'Link to the objectives',
      'Each objective traced to a gap.',
      'For each objective in the document memory, name the gap it addresses, in one sentence each.',
      'always',
      { targetWords: 150, noEvidence: true },
    ),
    el(
      'lit.summary',
      'Summary',
      'Accurate recap, nothing new.',
      'Summarise what the review established, claiming only what it contains. Nothing new, no new citations.',
      'university',
      { summary: true, targetWords: 120, noEvidence: true },
    ),
  ],
};

const paradigm = (
  key: string,
  title: string,
  purpose: string,
  instructions: string,
  paradigms: readonly Paradigm[],
  targetWords = 300,
): BlueprintElement =>
  el(key, title, purpose, instructions, 'paradigm', { paradigms, targetWords });

const METHOD: ChapterBlueprint = {
  role: 'METHOD',
  label: 'Methodology',
  elements: [
    el(
      'method.design',
      'Research design',
      'The overall design and why it suits the objectives.',
      'Describe the overall design and the reasons it suits the objectives, citing methodological sources where a passage supports the choice.',
      'always',
      { targetWords: 250 },
    ),
    // Experimental (engineering, sciences, pharmacy, agriculture)
    paradigm(
      'method.materials',
      'Materials and specifications',
      'What was used and to which specification.',
      'List the materials, grades, reagents or organisms with their specifications and sources.',
      ['experimental'],
    ),
    paradigm(
      'method.equipment',
      'Equipment',
      'The equipment and its settings.',
      'Describe the equipment, its make where stated in the sources, and the settings used.',
      ['experimental'],
    ),
    paradigm(
      'method.procedure',
      'Procedure',
      'What was done, in order.',
      'Describe the procedure step by step so it could be repeated.',
      ['experimental'],
      400,
    ),
    paradigm(
      'method.doe',
      'Experimental design',
      'Taguchi, RSM, RBD, factorial and the like.',
      'Name the experimental design, the factors, their levels and the number of runs or replications.',
      ['experimental'],
    ),
    paradigm(
      'method.standards',
      'Test standards, measurement and uncertainty',
      'Standards followed and how uncertainty was handled.',
      'Name the test standards followed and how measurements were taken, repeated and their uncertainty estimated.',
      ['experimental'],
    ),
    // Computational / CS
    paradigm(
      'method.formulation',
      'Problem formulation',
      'The problem stated formally.',
      'State the problem formally: inputs, outputs, constraints, and the notation used.',
      ['computational', 'design_build'],
    ),
    paradigm(
      'method.datasets',
      'Datasets',
      'Each dataset described before use.',
      'Describe each dataset: source, size, splits, preprocessing and any known limitations.',
      ['computational', 'design_build'],
    ),
    paradigm(
      'method.architecture',
      'Architecture or algorithm',
      'The system or algorithm in detail.',
      'Describe the architecture or algorithm in enough detail to reproduce it, with its parameters.',
      ['computational', 'design_build'],
      400,
    ),
    paradigm(
      'method.environment',
      'Implementation environment',
      'Hardware, software, versions.',
      'State the hardware, software, libraries and versions used.',
      ['computational', 'design_build', 'simulation'],
      150,
    ),
    paradigm(
      'method.baselines',
      'Baselines and evaluation metrics',
      'What is compared against and how it is measured.',
      'Name each baseline and each metric, and define every metric before it is used.',
      ['computational', 'design_build'],
    ),
    paradigm(
      'method.protocol',
      'Experimental protocol',
      'How the evaluation was run.',
      'Describe the evaluation protocol: runs, seeds, validation, and how results are reported.',
      ['computational', 'design_build'],
    ),
    // Simulation / numerical modelling (ADR-0047)
    paradigm(
      'method.model',
      'Model and governing equations',
      'The physics or mathematics the model solves.',
      'State the governing equations in LaTeX with every symbol defined, and the assumptions and simplifications made, citing the source of each model where a passage gives it.',
      ['simulation'],
      350,
    ),
    paradigm(
      'method.domain',
      'Domain, boundary and initial conditions',
      'Where the model is solved and under which conditions.',
      'Describe the geometry or domain, the boundary and initial conditions and the material properties, with their values and sources.',
      ['simulation'],
    ),
    paradigm(
      'method.numerics',
      'Numerical method and independence study',
      'How the equations are solved, and evidence that the answer does not depend on the grid.',
      'Name the discretisation, solver and convergence criteria, and report the mesh or time-step independence study.',
      ['simulation'],
    ),
    paradigm(
      'method.validation',
      'Verification and validation',
      'Evidence that the model is right.',
      'Report how the model was verified and validated against experimental or published data, with the agreement found, only as the passages give it.',
      ['simulation'],
    ),
    paradigm(
      'method.parametric',
      'Simulation plan',
      'The cases run.',
      'List the parameters varied, their ranges and the cases run.',
      ['simulation'],
      200,
    ),
    // Quantitative survey
    paradigm(
      'method.population',
      'Population and sampling',
      'Who, how many, how chosen.',
      'Describe the population, the sampling method, the sample size and how it was determined.',
      ['quantitative', 'mixed'],
    ),
    paradigm(
      'method.instrument',
      'Instrument',
      'The questionnaire or scale.',
      'Describe the instrument, its sections, its source and any adaptation.',
      ['quantitative', 'mixed'],
    ),
    paradigm(
      'method.pilot',
      'Pilot study, reliability and validity',
      'Evidence that the instrument works.',
      'Report the pilot study and the reliability and validity evidence (for example Cronbach’s alpha, factor analysis).',
      ['quantitative', 'mixed'],
    ),
    paradigm(
      'method.collection',
      'Data collection',
      'How and when the data were gathered.',
      'Describe how, when and from whom the data were collected.',
      ['quantitative', 'mixed', 'qualitative'],
    ),
    paradigm(
      'method.analysis',
      'Analysis techniques',
      'The statistical or analytical methods.',
      'Name the analysis techniques and the software, and match each to the hypothesis or question it answers.',
      ['quantitative', 'mixed', 'computational', 'experimental', 'simulation'],
    ),
    // Qualitative
    paradigm(
      'method.approach',
      'Approach',
      'Phenomenology, grounded theory, case study and the like.',
      'Name the qualitative approach and justify it for these research questions.',
      ['qualitative', 'mixed'],
    ),
    paradigm(
      'method.participants',
      'Participants and selection',
      'Who took part and how they were chosen.',
      'Describe the participants, how they were selected and how many, with the reasoning.',
      ['qualitative'],
    ),
    paradigm(
      'method.qual_analysis',
      'Analysis',
      'Thematic analysis, coding and the like.',
      'Describe how the data were analysed: coding, themes, tools, and who coded.',
      ['qualitative'],
    ),
    paradigm(
      'method.trustworthiness',
      'Trustworthiness and positionality',
      'Credibility, and the researcher’s own position.',
      'Describe how credibility, transferability and dependability were addressed, and state the researcher’s position in relation to the participants.',
      ['qualitative'],
    ),
    // Clinical
    paradigm(
      'method.setting',
      'Study setting',
      'Where and when.',
      'Describe the setting and the study period.',
      ['clinical'],
      150,
    ),
    paradigm(
      'method.eligibility',
      'Participants: inclusion and exclusion',
      'Who was eligible.',
      'State the inclusion and exclusion criteria and how participants were recruited.',
      ['clinical'],
    ),
    paradigm(
      'method.sample_size',
      'Sample size calculation',
      'How the size was justified.',
      'Give the sample size calculation with its assumptions.',
      ['clinical'],
      150,
    ),
    paradigm(
      'method.intervention',
      'Intervention and outcomes',
      'What was given and what was measured.',
      'Describe the intervention, the comparator and each outcome with how and when it was measured.',
      ['clinical'],
      400,
    ),
    paradigm(
      'method.statistics',
      'Statistical analysis',
      'The planned analysis.',
      'Describe the statistical analysis plan, the tests and the software.',
      ['clinical'],
    ),
    // Doctrinal (law)
    paradigm(
      'method.legal_sources',
      'Legal sources and jurisdictions',
      'What law is examined and where.',
      'Name the statutes, cases and other sources examined and the jurisdiction(s), and how they were selected.',
      ['doctrinal'],
    ),
    paradigm(
      'method.interpretive',
      'Interpretive approach',
      'How the sources are read.',
      'State the interpretive approach and, if comparative, the comparative framework and its limits.',
      ['doctrinal'],
    ),
    // Textual / critical (humanities)
    paradigm(
      'method.corpus',
      'Corpus and primary texts',
      'What is read and in which edition.',
      'Name the primary texts or corpus, with editions, and why they were chosen.',
      ['textual', 'theoretical'],
    ),
    paradigm(
      'method.lens',
      'Theoretical lens and method of reading',
      'How the texts are analysed.',
      'Define the theoretical lens and the method of reading or analysis, and its limits.',
      ['textual', 'theoretical'],
    ),
    el(
      'method.ethics',
      'Ethics',
      'Approval, consent and data protection.',
      'State the ethics approval, consent process and data protection measures, or say why they were not required.',
      'paradigm',
      { paradigms: ['quantitative', 'qualitative', 'mixed', 'clinical'], targetWords: 150 },
    ),
    el(
      'method.summary',
      'Summary',
      'Accurate recap, nothing new.',
      'Summarise the methodology in one paragraph, claiming only what the chapter contains.',
      'university',
      { summary: true, targetWords: 120, noEvidence: true },
    ),
  ],
};

const RESULTS: ChapterBlueprint = {
  role: 'RESULTS',
  label: 'Results and analysis',
  elements: [
    el(
      'results.intro',
      'Introduction to the results',
      'How the results are organised: in the order of the objectives.',
      'Say how the results are organised, following the order of the objectives or hypotheses. No figures here.',
      'always',
      { targetWords: 120, noEvidence: true },
    ),
    el(
      'results.objective',
      'Results by objective',
      'One section per objective or hypothesis; every table and figure referenced in the text.',
      'Present the results for this objective from the student’s data only. Report each statistic with its test, value, significance and effect size where given. Reference every table and figure in the text. Describe lightly; interpretation belongs in the Discussion. Where the data are not in the passages, write the structure with a placeholder [[DATA NEEDED: what is missing]] and no numbers.',
      'always',
      { perEntityGroup: true, dataOnly: true, targetWords: 400 },
    ),
    el(
      'results.summary',
      'Summary of results',
      'Accurate recap, nothing new.',
      'Summarise the results, claiming only what the chapter contains, with no new numbers.',
      'university',
      { summary: true, dataOnly: true, targetWords: 150, noEvidence: true },
    ),
  ],
};

const DISCUSSION: ChapterBlueprint = {
  role: 'DISCUSSION',
  label: 'Discussion',
  elements: [
    el(
      'discussion.result',
      'Interpretation by key result',
      'Each key result interpreted, compared with the literature, and linked to the objectives.',
      'Interpret this result: what it means, where it agrees and disagrees with the cited literature and why, and which objective it answers.',
      'always',
      { perEntityGroup: true, targetWords: 450 },
    ),
    el(
      'discussion.implications',
      'Implications',
      'For practice, policy or theory.',
      'State the implications for practice, policy or theory, each tied to a result.',
      'always',
      { targetWords: 250 },
    ),
    el(
      'discussion.limitations',
      'Limitations',
      'What the study could not do and why.',
      'State the limitations honestly and what each means for the conclusions.',
      'always',
      { targetWords: 200 },
    ),
    el(
      'discussion.summary',
      'Summary',
      'Accurate recap, nothing new.',
      'Summarise the discussion in one paragraph, claiming only what the chapter contains.',
      'university',
      { summary: true, targetWords: 120, noEvidence: true },
    ),
  ],
};

const CONCLUSION: ChapterBlueprint = {
  role: 'CONCLUSION',
  label: 'Conclusion',
  elements: [
    el(
      'conclusion.findings',
      'Findings per objective',
      'What was found, objective by objective.',
      'For each objective, state what was found, in one paragraph each, with no new results and no new citations.',
      'always',
      { targetWords: 350, noEvidence: true },
    ),
    el(
      'conclusion.contributions',
      'Contributions',
      'What is new.',
      'State the contributions of the thesis to knowledge and to practice.',
      'always',
      { targetWords: 200, noEvidence: true },
    ),
    el(
      'conclusion.recommendations',
      'Recommendations',
      'For practitioners, policy or the field.',
      'Make recommendations that follow from the findings.',
      'most',
      { targetWords: 200, noEvidence: true },
    ),
    el(
      'conclusion.limitations',
      'Limitations and future scope',
      'What is left to do.',
      'State the limitations and the future work they point to.',
      'always',
      { targetWords: 200, noEvidence: true },
    ),
  ],
};

/** The compilation template's paper chapters are the student's own published work; not built. */
export const CHAPTER_BLUEPRINTS: Readonly<Partial<Record<ChapterRole, ChapterBlueprint>>> = {
  INTRODUCTION,
  LITERATURE,
  METHOD,
  RESULTS,
  DISCUSSION,
  CONCLUSION,
};

export function blueprintFor(role: ChapterRole): ChapterBlueprint | null {
  return CHAPTER_BLUEPRINTS[role] ?? null;
}

/**
 * The elements that apply to one thesis: always-on ones, the paradigm's variants, the framework
 * when the discipline needs it, the summary when the university asks for it, and the "most"
 * elements unless the student disabled them.
 */
export function applicableElements(
  blueprint: ChapterBlueprint,
  options: {
    paradigm: Paradigm;
    requiresTheoreticalFramework: boolean;
    chapterSummaryRequired: boolean;
    disabled?: readonly string[];
  },
): BlueprintElement[] {
  const disabled = new Set(options.disabled ?? []);
  return blueprint.elements.filter((element) => {
    if (disabled.has(element.key) && element.required !== 'always') return false;
    switch (element.required) {
      case 'always':
        return true;
      case 'most':
        return true;
      case 'university':
        return options.chapterSummaryRequired;
      case 'framework':
        return options.requiresTheoreticalFramework;
      case 'paradigm':
        return (element.paradigms ?? []).includes(options.paradigm);
      default:
        return false;
    }
  });
}
