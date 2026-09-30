/**
 * Correctness checks in code — spec §7.1 T2 and §7.2 D-ENG1–D-ENG4. T1, T3 and T4 are the
 * examiner's. Everything here is exact: atom counting, a symbol table, a unit table and a
 * property-range table. Where the table has no row, the check says nothing.
 */

import { plainDigits, sentencesOf, stripCites } from './text.js';
import type { CheckContext, RawIssue } from './types.js';

// --------------------------------------------------------------------------------------------
// T2 — the pitfall bank, by pattern
// --------------------------------------------------------------------------------------------

export function checkPitfalls(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('T2')) return [];
  const issues: RawIssue[] = [];
  const compiled = ctx.pitfalls
    .filter((p) => p.pattern)
    .flatMap((p) => {
      try {
        return [{ pitfall: p, re: new RegExp(p.pattern as string, 'i') }];
      } catch {
        return [];
      }
    });
  if (compiled.length === 0) return [];
  for (const section of ctx.sections) {
    for (const raw of sentencesOf(section.markdown)) {
      const sentence = plainDigits(stripCites(raw));
      for (const { pitfall, re } of compiled) {
        if (!re.test(sentence)) continue;
        issues.push({
          checkId: 'T2',
          severity: pitfall.severity,
          sectionId: section.id,
          sentence: stripCites(raw),
          explanation: `Matches pitfall ${pitfall.code}: ${pitfall.wrong}.`,
          suggestedFix: pitfall.correct,
          pitfallCode: pitfall.code,
        });
      }
    }
  }
  return issues;
}

// --------------------------------------------------------------------------------------------
// D-ENG2 — chemical formulae; D-ENG1 — equation balance
// --------------------------------------------------------------------------------------------

const ELEMENTS = new Set(
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu'.split(
    ' ',
  ),
);

/** Fixed oxidation states, for the charge check on simple binary compounds. */
const FIXED_CHARGE: Readonly<Record<string, number>> = {
  H: 1,
  Li: 1,
  Na: 1,
  K: 1,
  Rb: 1,
  Cs: 1,
  Ag: 1,
  Mg: 2,
  Ca: 2,
  Sr: 2,
  Ba: 2,
  Zn: 2,
  Cd: 2,
  Al: 3,
  Ga: 3,
  F: -1,
  Cl: -1,
  Br: -1,
  I: -1,
  O: -2,
  S: -2,
  Se: -2,
  N: -3,
  P: -3,
};

export type Formula = Map<string, number>;

/** Parses `Al2(SO4)3` into element counts; null when a symbol is not an element. */
export function parseFormula(raw: string): Formula | null {
  const text = plainDigits(raw)
    .replace(/\s+/g, '')
    .replace(/·\d*H2O$/, '');
  if (!/^[A-Z(]/.test(text)) return null;
  const counts: Formula = new Map();
  const add = (into: Formula, element: string, n: number) =>
    into.set(element, (into.get(element) ?? 0) + n);
  const walk = (s: string, from: number, into: Formula): number => {
    let i = from;
    while (i < s.length) {
      const ch = s[i] as string;
      if (ch === '(') {
        const inner: Formula = new Map();
        const end = walk(s, i + 1, inner);
        if (end < 0 || s[end] !== ')') return -1;
        i = end + 1;
        const m = /^\d+/.exec(s.slice(i));
        const mult = m ? Number(m[0]) : 1;
        i += m ? m[0].length : 0;
        for (const [el, n] of inner) add(into, el, n * mult);
        continue;
      }
      if (ch === ')') return i;
      const sym = /^[A-Z][a-z]?/.exec(s.slice(i));
      if (!sym) return -1;
      let symbol = sym[0];
      // "Br" is an element; "Bx" is not, but "B" followed by a non-element lowercase is "B" + junk.
      if (!ELEMENTS.has(symbol)) {
        if (symbol.length === 2 && ELEMENTS.has(symbol[0] as string)) return -1;
        return -1;
      }
      i += symbol.length;
      const num = /^\d+/.exec(s.slice(i));
      const n = num ? Number(num[0]) : 1;
      i += num ? num[0].length : 0;
      symbol = symbol as string;
      add(into, symbol, n);
    }
    return i;
  };
  const end = walk(text, 0, counts);
  if (end !== text.length || counts.size === 0) return null;
  return counts;
}

/**
 * Charge neutrality for a binary compound of two fixed-charge elements: `K2Br` is +2 −1 and not a
 * compound; `Al2O3` is 0. Returns null when the elements are not both fixed-charge.
 */
export function chargeBalance(formula: Formula): number | null {
  if (formula.size !== 2) return null;
  let total = 0;
  for (const [el, n] of formula) {
    const charge = FIXED_CHARGE[el];
    if (charge === undefined) return null;
    total += charge * n;
  }
  return total;
}

/** Tokens that could be formulae: at least two element symbols or a symbol with a subscript. */
const FORMULA_TOKEN = /(?<![A-Za-z])((?:\(?[A-Z][a-z]?[0-9₀-₉]*\)?[0-9₀-₉]*){1,6})(?![a-z])/g;

function candidateFormulae(sentence: string): string[] {
  const out: string[] = [];
  for (const match of sentence.matchAll(FORMULA_TOKEN)) {
    const token = match[1] as string;
    const plain = plainDigits(token);
    const symbols = plain.match(/[A-Z][a-z]?/g) ?? [];
    const hasDigit = /\d/.test(plain);
    // "SEM", "EDM", "ASTM": all capitals, no digit, three or more letters — an abbreviation.
    if (!hasDigit && /^[A-Z]+$/.test(plain) && plain.length >= 3) continue;
    // A single symbol with no subscript ("Al", "Ti", "In") is a word or an element, not a formula.
    if (!hasDigit && symbols.length < 2) continue;
    // Two capitals with no digit and no lowercase ("TC", "IT") are letters, not "TiC".
    if (!hasDigit && !/[a-z]/.test(plain)) continue;
    out.push(token);
  }
  return out;
}

export function checkFormulae(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('D-ENG2')) return [];
  const issues: RawIssue[] = [];
  const seen = new Set<string>();
  for (const section of ctx.sections) {
    for (const raw of sentencesOf(section.markdown)) {
      const sentence = stripCites(raw);
      for (const token of candidateFormulae(sentence)) {
        const key = `${section.id}|${plainDigits(token)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const formula = parseFormula(token);
        if (!formula) {
          // Only a token with a subscript and a lowercase letter is confidently a formula: "Xz2",
          // not "AA7050", "AZ91" or "H13", which are alloy designations.
          if (!/[0-9₀-₉]/.test(token) || !/[a-z]/.test(token)) continue;
          issues.push({
            checkId: 'D-ENG2',
            severity: 'blocking',
            sectionId: section.id,
            sentence,
            explanation: `“${token}” is not a valid chemical formula: it contains a symbol that is not an element.`,
            suggestedFix: 'Check the compound’s formula against a reference and correct it.',
          });
          continue;
        }
        const charge = chargeBalance(formula);
        if (charge !== null && charge !== 0) {
          issues.push({
            checkId: 'D-ENG2',
            severity: 'blocking',
            sectionId: section.id,
            sentence,
            explanation: `“${token}” is not a compound: its charges do not balance (${charge > 0 ? '+' : ''}${charge}).`,
            suggestedFix: 'Check the compound’s formula against a reference and correct it.',
          });
        }
      }
    }
  }
  return issues;
}

const ARROW = /(→|⟶|->|—>|⇌|⇒)/;

const SPECIES_TOKEN = /^\d*\(?[A-Z][A-Za-z0-9()]*(?:\((?:s|l|g|aq)\))?$/;

/**
 * The run of species tokens ("2Al", "+", "3CuO") at the end of the left side or the start of the
 * right side, so "The reaction Al + CuO → Al2O3 + Cu was proposed" reads as Al + CuO → Al2O3 + Cu.
 */
function speciesRun(text: string, fromEnd: boolean): string[] {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const ordered = fromEnd ? [...tokens].reverse() : tokens;
  const run: string[] = [];
  for (const token of ordered) {
    const clean = token.replace(/[.,;:]$/, '');
    if (clean === '+' || SPECIES_TOKEN.test(clean)) {
      run.push(clean);
      if (clean !== token) break; // punctuation ended the equation
      continue;
    }
    break;
  }
  const species = fromEnd ? run.reverse() : run;
  // Trim a dangling "+" at either end.
  while (species[0] === '+') species.shift();
  while (species[species.length - 1] === '+') species.pop();
  return species;
}

/** Sums the atoms of "2Al + 3CuO"; null when any species does not parse. */
function parseSide(tokens: readonly string[]): Formula | null {
  if (tokens.length === 0) return null;
  const total: Formula = new Map();
  for (const rawSpecies of tokens.join(' ').split('+')) {
    const species = rawSpecies
      .trim()
      .replace(/\((?:s|l|g|aq)\)$/i, '')
      .trim();
    if (!species) return null;
    const m = /^(\d+)\s*(.+)$/.exec(species);
    const coefficient = m ? Number(m[1]) : 1;
    const formula = parseFormula(m ? (m[2] as string) : species);
    if (!formula) return null;
    for (const [el, n] of formula) total.set(el, (total.get(el) ?? 0) + n * coefficient);
  }
  return total;
}

/** D-ENG1: every reaction written with an arrow balances by atom count. */
export function checkEquations(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('D-ENG1')) return [];
  const issues: RawIssue[] = [];
  for (const section of ctx.sections) {
    for (const raw of sentencesOf(section.markdown)) {
      const sentence = plainDigits(stripCites(raw));
      if (!ARROW.test(sentence)) continue;
      const parts = sentence.split(ARROW);
      if (parts.length < 3) continue;
      const lhs = parseSide(speciesRun(parts[0] as string, true));
      const rhs = parseSide(speciesRun(parts[2] as string, false));
      if (!lhs || !rhs) continue;
      const elements = new Set([...lhs.keys(), ...rhs.keys()]);
      const unbalanced = [...elements].filter((el) => (lhs.get(el) ?? 0) !== (rhs.get(el) ?? 0));
      if (unbalanced.length === 0) continue;
      issues.push({
        checkId: 'D-ENG1',
        severity: 'blocking',
        sectionId: section.id,
        sentence: stripCites(raw),
        explanation: `The equation does not balance: ${unbalanced
          .map((el) => `${el} ${lhs.get(el) ?? 0} → ${rhs.get(el) ?? 0}`)
          .join(', ')}.`,
        suggestedFix: 'Balance the equation, or cite the source that gives it and copy it exactly.',
      });
    }
  }
  return issues;
}

// --------------------------------------------------------------------------------------------
// D-ENG4 — units
// --------------------------------------------------------------------------------------------

const NON_SI: Readonly<Record<string, string>> = {
  psi: 'MPa (1 psi = 6.895 kPa)',
  ksi: 'MPa (1 ksi = 6.895 MPa)',
  inch: 'mm (1 inch = 25.4 mm)',
  inches: 'mm (1 inch = 25.4 mm)',
  in: 'mm (1 inch = 25.4 mm)',
  ft: 'm (1 ft = 0.3048 m)',
  lb: 'kg (1 lb = 0.4536 kg)',
  lbs: 'kg (1 lb = 0.4536 kg)',
  lbf: 'N (1 lbf = 4.448 N)',
  '°F': '°C',
  hp: 'kW (1 hp = 0.7457 kW)',
  mph: 'km/h or m/s',
};

type UnitClass =
  | 'stress'
  | 'density'
  | 'hardness'
  | 'temperature'
  | 'length'
  | 'speed'
  | 'current'
  | 'voltage'
  | 'time'
  | 'mass'
  | 'force'
  | 'energy'
  | 'power'
  | 'frequency'
  | 'volume'
  | 'fraction';

const UNIT_CLASS: Readonly<Record<string, UnitClass>> = {
  Pa: 'stress',
  kPa: 'stress',
  MPa: 'stress',
  GPa: 'stress',
  psi: 'stress',
  ksi: 'stress',
  'g/cm3': 'density',
  'g/cm³': 'density',
  'kg/m3': 'density',
  'kg/m³': 'density',
  HV: 'hardness',
  HRC: 'hardness',
  HRB: 'hardness',
  HB: 'hardness',
  '°C': 'temperature',
  '°F': 'temperature',
  K: 'temperature',
  m: 'length',
  mm: 'length',
  cm: 'length',
  km: 'length',
  µm: 'length',
  um: 'length',
  nm: 'length',
  in: 'length',
  inch: 'length',
  inches: 'length',
  ft: 'length',
  'm/s': 'speed',
  'm/min': 'speed',
  'mm/min': 'speed',
  rpm: 'speed',
  mph: 'speed',
  A: 'current',
  mA: 'current',
  V: 'voltage',
  kV: 'voltage',
  s: 'time',
  ms: 'time',
  µs: 'time',
  min: 'time',
  h: 'time',
  hours: 'time',
  hour: 'time',
  mg: 'mass',
  g: 'mass',
  kg: 'mass',
  lb: 'mass',
  lbs: 'mass',
  N: 'force',
  kN: 'force',
  lbf: 'force',
  J: 'energy',
  kJ: 'energy',
  W: 'power',
  kW: 'power',
  hp: 'power',
  Hz: 'frequency',
  kHz: 'frequency',
  MHz: 'frequency',
  GHz: 'frequency',
  mL: 'volume',
  ml: 'volume',
  L: 'volume',
  µL: 'volume',
  '%': 'fraction',
};

/** What a quantity word should be measured in. Hardness in GPa/MPa is accepted (Vickers in GPa). */
const QUANTITY_CLASS: ReadonlyArray<{ re: RegExp; classes: readonly UnitClass[]; name: string }> = [
  { re: /\bdensit(?:y|ies)\b/i, classes: ['density'], name: 'density' },
  { re: /\bhardness\b/i, classes: ['hardness', 'stress'], name: 'hardness' },
  {
    re: /\b(?:melting|boiling|sintering|annealing|ageing|aging|curing|operating|ambient|room)\s+(?:point|temperature)\b|\btemperatures?\b/i,
    classes: ['temperature'],
    name: 'temperature',
  },
  {
    re: /\b(?:tensile|yield|compressive|flexural|shear|fatigue|impact)\s+strength\b|\bstress(?:es)?\b|\bpressures?\b|\b(?:young'?s|elastic|shear)\s+modulus\b/i,
    classes: ['stress'],
    name: 'a stress or strength',
  },
  {
    re: /\b(?:cutting|sliding|feed|wire|table|rotational|spindle)\s+(?:speed|velocity)\b|\bvelocit(?:y|ies)\b/i,
    classes: ['speed'],
    name: 'a speed',
  },
  {
    re: /\b(?:peak|discharge|pulse|input|output)?\s*currents?\b/i,
    classes: ['current'],
    name: 'a current',
  },
  {
    re: /\b(?:gap|open[\s-]circuit|servo|applied|discharge)?\s*voltages?\b/i,
    classes: ['voltage'],
    name: 'a voltage',
  },
  {
    re: /\b(?:thickness|diameter|length|width|depth|distance|gap|grain size|particle size|radius)\b/i,
    classes: ['length'],
    name: 'a length',
  },
  {
    re: /\b(?:pulse[\s-]on|pulse[\s-]off|machining|sintering|holding|soaking|dwell|exposure)\s+(?:time|duration)\b|\bdurations?\b/i,
    classes: ['time'],
    name: 'a time',
  },
  { re: /\b(?:mass|weight)\b/i, classes: ['mass', 'fraction'], name: 'a mass' },
  {
    re: /\b(?:normal|applied|contact)\s+(?:load|force)\b|\bforces?\b/i,
    classes: ['force'],
    name: 'a force',
  },
];

const VALUE_UNIT =
  /(\d+(?:\.\d+)?)\s?(%|°C|°F|GPa|MPa|kPa|Pa|psi|ksi|g\/cm[³3]|kg\/m[³3]|HV|HRC|HRB|HB|µm|um|nm|mm|cm|km|m\/s|m\/min|mm\/min|rpm|mph|mA|kV|kN|kJ|kW|kHz|MHz|GHz|Hz|hp|mg|kg|mL|ml|µL|inch(?:es)?|hours?|lbf|lbs|lb|ft|in|ms|µs|min|h|s|A|V|N|J|W|K|L|g|m)(?![\p{L}\p{N}/])/gu;

export function checkUnits(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('D-ENG4')) return [];
  const issues: RawIssue[] = [];
  for (const section of ctx.sections) {
    for (const raw of sentencesOf(section.markdown)) {
      const sentence = stripCites(raw);
      for (const match of sentence.matchAll(VALUE_UNIT)) {
        const unit = match[2] as string;
        const index = match.index ?? 0;
        const conversion = NON_SI[unit];
        if (conversion) {
          issues.push({
            checkId: 'D-ENG4',
            severity: 'warning',
            sectionId: section.id,
            sentence,
            explanation: `“${match[0]}” uses a non-SI unit.`,
            suggestedFix: `Give the value in ${conversion}, with the original in brackets if the source used it.`,
          });
        }
        const cls = UNIT_CLASS[unit];
        if (!cls) continue;
        const before = sentence.slice(Math.max(0, index - 70), index);
        const quantity = QUANTITY_CLASS.find((q) => q.re.test(before));
        if (!quantity || quantity.classes.includes(cls)) continue;
        issues.push({
          checkId: 'D-ENG4',
          severity: 'blocking',
          sectionId: section.id,
          sentence,
          explanation: `“${match[0]}” gives ${quantity.name} in a unit of ${cls}.`,
          suggestedFix: `Check the value and its unit against the source; ${quantity.name} is not measured in ${unit}.`,
        });
      }
    }
  }
  return issues;
}

// --------------------------------------------------------------------------------------------
// D-ENG3 — property plausibility
// --------------------------------------------------------------------------------------------

type Property = 'hardness' | 'density' | 'melting';

type PropertyRange = {
  material: RegExp;
  name: string;
  property: Property;
  /** Hardness in GPa, density in g/cm³, melting point in °C. */
  min: number;
  max: number;
};

/** Handbook ranges, wide on purpose: a value outside them is not a measurement, it is an error. */
export const PROPERTY_RANGES: readonly PropertyRange[] = [
  { material: /\bgraphite\b/i, name: 'graphite', property: 'hardness', min: 0.005, max: 1 },
  { material: /\bgraphite\b/i, name: 'graphite', property: 'density', min: 1.7, max: 2.3 },
  {
    material: /\bTi3Al\b|\btitanium aluminide\b/i,
    name: 'Ti3Al',
    property: 'hardness',
    min: 2,
    max: 8,
  },
  {
    material: /\bTi3Al\b|\btitanium aluminide\b/i,
    name: 'Ti3Al',
    property: 'density',
    min: 4.1,
    max: 4.4,
  },
  {
    material: /\bAl2O3\b|\balumina\b|\baluminium oxide\b|\baluminum oxide\b/i,
    name: 'alumina',
    property: 'density',
    min: 3.7,
    max: 4.1,
  },
  {
    material: /\bAl2O3\b|\balumina\b|\baluminium oxide\b|\baluminum oxide\b/i,
    name: 'alumina',
    property: 'hardness',
    min: 12,
    max: 25,
  },
  {
    material: /\bAl2O3\b|\balumina\b/i,
    name: 'alumina',
    property: 'melting',
    min: 1950,
    max: 2100,
  },
  {
    material: /\bSiC\b|\bsilicon carbide\b/i,
    name: 'silicon carbide',
    property: 'density',
    min: 3.0,
    max: 3.3,
  },
  {
    material: /\bSiC\b|\bsilicon carbide\b/i,
    name: 'silicon carbide',
    property: 'hardness',
    min: 18,
    max: 32,
  },
  {
    material: /\bTiC\b|\btitanium carbide\b/i,
    name: 'titanium carbide',
    property: 'hardness',
    min: 22,
    max: 34,
  },
  {
    material: /\bTiC\b|\btitanium carbide\b/i,
    name: 'titanium carbide',
    property: 'density',
    min: 4.8,
    max: 5.0,
  },
  {
    material: /\bB4C\b|\bboron carbide\b/i,
    name: 'boron carbide',
    property: 'hardness',
    min: 26,
    max: 42,
  },
  {
    material: /\bB4C\b|\bboron carbide\b/i,
    name: 'boron carbide',
    property: 'density',
    min: 2.4,
    max: 2.6,
  },
  {
    material: /\bTiB2\b|\btitanium diboride\b/i,
    name: 'titanium diboride',
    property: 'hardness',
    min: 22,
    max: 36,
  },
  {
    material: /\bWC\b|\btungsten carbide\b/i,
    name: 'tungsten carbide',
    property: 'density',
    min: 15.3,
    max: 15.9,
  },
  {
    material: /\bWC\b|\btungsten carbide\b/i,
    name: 'tungsten carbide',
    property: 'hardness',
    min: 16,
    max: 28,
  },
  { material: /\bZrO2\b|\bzirconia\b/i, name: 'zirconia', property: 'density', min: 5.5, max: 6.2 },
  { material: /\bZrO2\b|\bzirconia\b/i, name: 'zirconia', property: 'hardness', min: 9, max: 16 },
  {
    material: /\bSi3N4\b|\bsilicon nitride\b/i,
    name: 'silicon nitride',
    property: 'hardness',
    min: 13,
    max: 21,
  },
  { material: /\bfly ash\b/i, name: 'fly ash', property: 'density', min: 1.8, max: 2.8 },
  {
    material: /\balumin(?:i)?um(?:\s+alloys?)?\b|\bAA\d{4}\b|\bAl\d{4}\b|\bLM\d{1,2}\b/i,
    name: 'aluminium and its alloys',
    property: 'density',
    min: 2.5,
    max: 3.0,
  },
  {
    material: /\balumin(?:i)?um(?:\s+alloys?)?\b|\bAA\d{4}\b|\bAl\d{4}\b/i,
    name: 'aluminium and its alloys',
    property: 'melting',
    min: 470,
    max: 680,
  },
  {
    material: /\balumin(?:i)?um(?:\s+alloys?)?\b|\bAA\d{4}\b|\bAl\d{4}\b/i,
    name: 'aluminium and its alloys',
    property: 'hardness',
    min: 0.15,
    max: 2.5,
  },
  {
    material: /\btitanium(?:\s+alloys?)?\b|\bTi-?6Al-?4V\b/i,
    name: 'titanium and its alloys',
    property: 'density',
    min: 4.3,
    max: 4.7,
  },
  {
    material: /\btitanium(?:\s+alloys?)?\b|\bTi-?6Al-?4V\b/i,
    name: 'titanium and its alloys',
    property: 'melting',
    min: 1550,
    max: 1700,
  },
  {
    material: /\bmagnesium(?:\s+alloys?)?\b|\bAZ\d{2}\b/i,
    name: 'magnesium and its alloys',
    property: 'density',
    min: 1.6,
    max: 2.0,
  },
  {
    material: /\bmagnesium(?:\s+alloys?)?\b|\bAZ\d{2}\b/i,
    name: 'magnesium and its alloys',
    property: 'melting',
    min: 550,
    max: 660,
  },
  {
    material: /\bsteels?\b|\bAISI\s?\d{3,4}\b|\bEN\s?\d{1,2}\b|\bHastelloy\b|\bInconel\b/i,
    name: 'steel or nickel alloy',
    property: 'density',
    min: 7.5,
    max: 9.0,
  },
  {
    material: /\bsteels?\b|\bAISI\s?\d{3,4}\b/i,
    name: 'steel',
    property: 'melting',
    min: 1350,
    max: 1550,
  },
  { material: /\bcopper\b/i, name: 'copper', property: 'density', min: 8.8, max: 9.0 },
  { material: /\bcopper\b/i, name: 'copper', property: 'melting', min: 1080, max: 1090 },
];

const PROPERTY_WORD: Readonly<Record<Property, RegExp>> = {
  hardness: /\bhardness\b/i,
  density: /\bdensit(?:y|ies)\b/i,
  melting: /\bmelting\s+(?:point|temperature)\b|\bmelts\s+at\b/i,
};

/** Converts a stated value to the table's unit: GPa, g/cm³, °C. Null when the unit does not fit. */
function toTableUnit(property: Property, value: number, unit: string): number | null {
  switch (property) {
    case 'hardness':
      if (unit === 'GPa') return value;
      if (unit === 'MPa') return value / 1000;
      if (unit === 'HV' || unit === 'HB') return value * 0.009807;
      return null;
    case 'density':
      if (/^g\/cm/.test(unit)) return value;
      if (/^kg\/m/.test(unit)) return value / 1000;
      return null;
    case 'melting':
      if (unit === '°C') return value;
      if (unit === 'K') return value - 273.15;
      if (unit === '°F') return ((value - 32) * 5) / 9;
      return null;
    default:
      return null;
  }
}

export function checkPropertyRanges(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('D-ENG3')) return [];
  const issues: RawIssue[] = [];
  for (const section of ctx.sections) {
    for (const raw of sentencesOf(section.markdown)) {
      const sentence = plainDigits(stripCites(raw));
      for (const match of sentence.matchAll(VALUE_UNIT)) {
        const value = Number(match[1]);
        const unit = match[2] as string;
        const index = match.index ?? 0;
        const window = sentence.slice(Math.max(0, index - 120), index + match[0].length + 40);
        for (const row of PROPERTY_RANGES) {
          if (!PROPERTY_WORD[row.property].test(window) || !row.material.test(window)) continue;
          const converted = toTableUnit(row.property, value, unit);
          if (converted === null) continue;
          if (converted >= row.min && converted <= row.max) continue;
          const unitName =
            row.property === 'hardness' ? 'GPa' : row.property === 'density' ? 'g/cm³' : '°C';
          issues.push({
            checkId: 'D-ENG3',
            severity: 'blocking',
            sectionId: section.id,
            sentence: stripCites(raw),
            explanation: `${row.name}: a ${row.property === 'melting' ? 'melting point' : row.property} of ${match[0]} is outside the handbook range ${row.min}–${row.max} ${unitName}.`,
            suggestedFix: `Check the value against the cited source or a materials handbook (${row.name} ${row.property === 'melting' ? 'melts at' : `has a ${row.property} of`} about ${row.min}–${row.max} ${unitName}).`,
          });
          break;
        }
      }
    }
  }
  return issues;
}
