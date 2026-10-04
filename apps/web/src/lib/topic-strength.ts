/**
 * How complete a topic sentence is, before it is sent — a coaching aid for the proposal's first
 * message (docs/research/coverage-map.md row 3, from the Jenni study).
 *
 * Deliberately not AI and deliberately boring: four questions a supervisor would ask of any topic
 * (what is studied, where or who, how, and to what end), each answered by a word list a student
 * can read. It never blocks sending; it only says which of the four is still missing. A topic that
 * fools the word lists costs nothing — the conversation that follows asks the real questions.
 */

export type TopicPart = 'subject' | 'setting' | 'method' | 'aim';
export type TopicStrength = 'weak' | 'fair' | 'strong';

export type TopicCheck = { part: TopicPart; met: boolean; hint: string };

export type TopicScore = {
  strength: TopicStrength;
  /** The four parts, in the order they are listed to the student. */
  checks: TopicCheck[];
  /** Short hints for the parts still missing, plus one about length when it is too short. */
  hints: string[];
  words: number;
};

export const TOPIC_HINTS: Record<TopicPart, string> = {
  subject: 'Name the subject: what is being studied',
  setting: 'Add where or who: a place, population or dataset',
  method: 'Add how: a method such as a survey, experiment, model or case study',
  aim: 'Add the aim: what you want to find out, compare or improve',
};

export const LENGTH_HINT = 'Say a little more: one sentence of 10 to 30 words works best';

/** Three good topics in an Indian setting — engineering, nursing, management — for the placeholder. */
export const EXAMPLE_TOPICS: readonly string[] = [
  'Effect of rice-husk ash on the compressive strength of concrete for coastal buildings in Tamil Nadu: a laboratory experiment',
  'Effect of a structured teaching programme on insulin self-care among diabetic patients in a Chennai hospital: a quasi-experimental study',
  'Factors influencing UPI adoption among small retailers in Pune: a survey with structural equation modelling',
];

const STOP = new Set(
  'a an the of on in at for to and or with by from into among between about as is are be this that these those my our its their using how what why whether which study research thesis topic'.split(
    ' ',
  ),
);

/** A place, a population or a body of data. */
const SETTING = [
  /\b(india|indian|rural|urban|village|villages|district|districts|state|states|city|cities|region|coastal|tribal|campus|hospital|hospitals|clinic|clinics|school|schools|college|colleges|universit(y|ies)|compan(y|ies)|firm|firms|industry|industries|sector|msmes?|smes?|plant|factory|factories)\b/i,
  /\b(students?|patients?|nurses?|teachers?|farmers?|smallholders?|women|men|mothers?|children|adolescents?|adults?|elderly|employees?|workers?|managers?|consumers?|customers?|retailers?|investors?|households?|users?|population|participants?|respondents?)\b/i,
  /\b(dataset|data set|data|records|corpus|cohort|sample|images|census|survey data)\b/i,
  /\b(tamil nadu|kerala|karnataka|andhra|telangana|maharashtra|gujarat|rajasthan|punjab|haryana|bihar|odisha|west bengal|assam|delhi|mumbai|chennai|bengaluru|bangalore|hyderabad|kolkata|pune|kochi|madurai|coimbatore)\b/i,
  // "in Pichavaram", "among Irula", "at AIIMS": a preposition before a proper noun.
  /\b(in|among|at|across|within|from)\s+[A-Z][\w-]+/,
];

/** How the work is done. */
const METHOD = [
  /\b(survey|surveys|questionnaires?|interviews?|focus groups?|case stud(y|ies)|experiments?|experimental|quasi-experimental|trials?|randomi[sz]ed|cross-sectional|longitudinal|cohort study|ethnograph\w*|observational|field study|fieldwork|content analysis|thematic analysis|grounded theory|meta-analysis|systematic review|literature review|regression|anova|structural equation|sem|panel data|time series|simulations?|modell?ing|models?|finite element|fea|fem|cfd|machine learning|deep learning|neural networks?|cnn|lstm|algorithms?|prototype|laboratory|lab tests?|measurements?|measured|testing|tested|qualitative|quantitative|mixed[- ]methods?|delphi|comparative)\b/i,
  /\busing\s+\w+/i,
];

/** What the work is for. */
const AIM = [
  /\b(effects?|impacts?|influence|role|relationship|association|associated|determinants|factors|predictors?|causes?|outcomes?|effectiveness|efficacy|feasibility|performance|adoption|barriers)\b/i,
  /\b(compar\w*|versus|vs\.?|predict\w*|evaluat\w*|assess\w*|improv\w*|reduc\w*|increas\w*|enhanc\w*|optimi[sz]\w*|develop\w*|design\w*|examin\w*|explor\w*|investigat\w*|identif\w*|determin\w*|understand\w*|measur\w*|estimat\w*|analy[sz]\w*)\b/i,
  /\b(whether|how|why)\b/i,
  /\?/,
];

function matches(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/** Scores a topic sentence. Pure; called on every keystroke. */
export function scoreTopic(input: string): TopicScore {
  const text = input.trim();
  const tokens = text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t));
  const words = tokens.length;
  const content = tokens.filter((t) => {
    const w = t.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '');
    return w.length >= 3 && !STOP.has(w);
  });

  const met: Record<TopicPart, boolean> = {
    subject: content.length >= 2,
    setting: matches(text, SETTING),
    method: matches(text, METHOD),
    aim: matches(text, AIM),
  };
  const parts: TopicPart[] = ['subject', 'setting', 'method', 'aim'];
  const checks = parts.map((part) => ({ part, met: met[part], hint: TOPIC_HINTS[part] }));
  const count = checks.filter((c) => c.met).length;

  let strength: TopicStrength = 'weak';
  if (words >= 8 && count === parts.length) strength = 'strong';
  else if (words >= 4 && count >= 2) strength = 'fair';

  const hints = checks.filter((c) => !c.met).map((c) => c.hint);
  if (words > 0 && words < 8) hints.push(LENGTH_HINT);

  return { strength, checks, hints, words };
}
