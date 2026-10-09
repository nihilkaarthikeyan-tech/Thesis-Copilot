/**
 * ADR-0135: a sentence set in a place the thesis is not about, written as if it were.
 *
 * Seen live on the real models (2026-10-09): a thesis on rooftop solar among rural households in
 * Karnataka, Start writing now, and the opener under the empty chapter offered "In Kerala,
 * abundant solar potential combined with initiatives like the SOURA subsidy program positions the
 * state as a leader in rooftop solar photovoltaic adoption, yet barriers … continue to hinder
 * widespread implementation among households (Mathew 2024)". A neighbouring state's programme,
 * framing a Karnataka thesis, with nothing saying it is evidence from somewhere else.
 *
 * A place is "the thesis's own" when the thesis's scope (its title, problem statement, chapter
 * and section notes) names it, or names a place inside it (Karnataka → India), or the place lies
 * inside one the scope names (a thesis on India owns every Indian state). Any other state or
 * country is another setting. A sentence that names another setting is honest when it says so:
 * comparison wording ("unlike", "in neighbouring Kerala", "elsewhere"), or the wording of a study
 * reporting its own setting ("a survey of 200 households in Kerala found …"). Without either, it
 * is counted. Districts and cities are not listed: a district is almost always inside the
 * thesis's own state, and a wrong guess there would count an honest sentence.
 */

/** Indian states and union territories, and the spellings students and papers use for them. */
const INDIAN_STATES: Record<string, string[]> = {
  'Andhra Pradesh': ['andhra pradesh'],
  'Arunachal Pradesh': ['arunachal pradesh'],
  Assam: ['assam'],
  Bihar: ['bihar'],
  Chhattisgarh: ['chhattisgarh', 'chattisgarh'],
  Goa: ['goa'],
  Gujarat: ['gujarat'],
  Haryana: ['haryana'],
  'Himachal Pradesh': ['himachal pradesh'],
  Jharkhand: ['jharkhand'],
  Karnataka: ['karnataka'],
  Kerala: ['kerala'],
  'Madhya Pradesh': ['madhya pradesh'],
  Maharashtra: ['maharashtra'],
  Manipur: ['manipur'],
  Meghalaya: ['meghalaya'],
  Mizoram: ['mizoram'],
  Nagaland: ['nagaland'],
  Odisha: ['odisha', 'orissa'],
  Punjab: ['punjab'],
  Rajasthan: ['rajasthan'],
  Sikkim: ['sikkim'],
  'Tamil Nadu': ['tamil nadu', 'tamilnadu'],
  Telangana: ['telangana'],
  Tripura: ['tripura'],
  'Uttar Pradesh': ['uttar pradesh'],
  Uttarakhand: ['uttarakhand', 'uttaranchal'],
  'West Bengal': ['west bengal'],
  Delhi: ['delhi'],
  'Jammu and Kashmir': ['jammu and kashmir', 'jammu & kashmir', 'kashmir'],
  Ladakh: ['ladakh'],
  Puducherry: ['puducherry', 'pondicherry'],
  Chandigarh: ['chandigarh'],
};

/** Countries a thesis or its sources commonly name. Not exhaustive; unlisted places never count. */
const COUNTRIES: Record<string, string[]> = {
  India: ['india'],
  Bangladesh: ['bangladesh'],
  Pakistan: ['pakistan'],
  Nepal: ['nepal'],
  'Sri Lanka': ['sri lanka'],
  Bhutan: ['bhutan'],
  China: ['china'],
  Indonesia: ['indonesia'],
  Malaysia: ['malaysia'],
  Thailand: ['thailand'],
  Vietnam: ['vietnam', 'viet nam'],
  Philippines: ['philippines'],
  Japan: ['japan'],
  'South Korea': ['south korea', 'korea'],
  Australia: ['australia'],
  'New Zealand': ['new zealand'],
  'United States': ['united states', 'usa', 'u.s.'],
  Canada: ['canada'],
  Mexico: ['mexico'],
  Brazil: ['brazil'],
  Chile: ['chile'],
  'United Kingdom': ['united kingdom', 'britain', 'england', 'scotland', 'wales'],
  Ireland: ['ireland'],
  Germany: ['germany'],
  France: ['france'],
  Italy: ['italy'],
  Spain: ['spain'],
  Portugal: ['portugal'],
  Netherlands: ['netherlands'],
  Belgium: ['belgium'],
  Switzerland: ['switzerland'],
  Austria: ['austria'],
  Sweden: ['sweden'],
  Norway: ['norway'],
  Denmark: ['denmark'],
  Finland: ['finland'],
  Poland: ['poland'],
  Greece: ['greece'],
  Turkey: ['turkey', 'türkiye'],
  Iran: ['iran'],
  'Saudi Arabia': ['saudi arabia'],
  'United Arab Emirates': ['united arab emirates', 'uae'],
  Egypt: ['egypt'],
  Nigeria: ['nigeria'],
  Ghana: ['ghana'],
  Kenya: ['kenya'],
  Uganda: ['uganda'],
  Tanzania: ['tanzania'],
  Ethiopia: ['ethiopia'],
  Rwanda: ['rwanda'],
  Malawi: ['malawi'],
  Zambia: ['zambia'],
  Zimbabwe: ['zimbabwe'],
  'South Africa': ['south africa'],
};

/** Each place's parent: an Indian state is inside India. */
const PARENT: Record<string, string> = Object.fromEntries(
  Object.keys(INDIAN_STATES).map((state) => [state, 'India']),
);

const ALIASES: Array<{ place: string; pattern: RegExp }> = Object.entries({
  ...INDIAN_STATES,
  ...COUNTRIES,
})
  .flatMap(([place, names]) => names.map((name) => ({ place, name })))
  // Longest first, so "south korea" is found before "korea".
  .sort((a, b) => b.name.length - a.name.length)
  .map(({ place, name }) => ({
    place,
    pattern: new RegExp(`(?<![\\p{L}])${name.replace(/\./g, '\\.')}(?![\\p{L}])`, 'iu'),
  }));

/** The places a text names, by their canonical names. Cite markers are ignored. */
export function placesIn(text: string): Set<string> {
  let rest = text.replace(/\{\{cite:[^}]+\}\}/g, ' ');
  const found = new Set<string>();
  for (const { place, pattern } of ALIASES) {
    const match = pattern.exec(rest);
    if (!match) continue;
    found.add(place);
    // Blank the match so a shorter alias ("korea") is not found inside a longer one.
    rest = rest.replace(new RegExp(pattern.source, 'giu'), ' ');
  }
  return found;
}

/** The places that belong to a thesis whose scope names `scopePlaces`. */
export function ownPlaces(scopePlaces: ReadonlySet<string>): Set<string> {
  const own = new Set<string>();
  for (const place of scopePlaces) {
    own.add(place);
    const parent = PARENT[place];
    if (parent) own.add(parent);
    // A thesis about a country owns the places inside it.
    for (const [child, of] of Object.entries(PARENT)) if (of === place) own.add(child);
  }
  return own;
}

/**
 * Wording that marks a place as another setting: a comparison, or a study reporting where it
 * was done. "In Kerala, abundant solar potential … positions the state as a leader" has neither.
 */
const MARKED_AS_ELSEWHERE = [
  /\b(unlike|in contrast|by contrast|contrast(s|ing)? with|compared (with|to)|comparison|comparable|similar(ly)?|likewise|as in|as elsewhere|elsewhere|other (indian )?(states?|countries|regions|parts)|another (state|country|region)|neighbou?ring|outside|beyond|whereas)\b/i,
  /\b(a|one|an earlier|a recent|the)?\s*(study|studies|survey|surveys|research|evidence|experience|data|analysis|trial|assessment|work)\s+(in|from|of|on|across|conducted in|carried out in|set in)\b/i,
  /\b(found|find|finds|reported|reports|report|observed|observes|showed|shows|show|documented|documents|identified|identifies|estimated|estimates|recorded|records|noted|notes|surveyed|interviewed|measured|measures)\b/i,
];

export function marksAnotherSetting(sentence: string): boolean {
  return MARKED_AS_ELSEWHERE.some((re) => re.test(sentence));
}

/**
 * The other settings a sentence names without marking them as such: empty when it names none, or
 * marks the ones it names, or the scope names no place at all (a thesis with no setting cannot be
 * mismatched).
 */
export function unmarkedOtherSettings(sentence: string, scopeText: string): string[] {
  const scope = placesIn(scopeText);
  if (scope.size === 0) return [];
  const own = ownPlaces(scope);
  const others = [...placesIn(sentence)].filter((p) => !own.has(p));
  if (others.length === 0 || marksAnotherSetting(sentence)) return [];
  return others;
}
