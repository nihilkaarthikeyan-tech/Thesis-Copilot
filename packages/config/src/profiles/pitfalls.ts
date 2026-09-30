/**
 * The pitfall bank's seed — ADR-0039, the specification's §8.3 "seed entries (engineering, from
 * the evaluation)". Every entry here came from Ranjith's evaluation of a real PhD chapter, so it
 * is seeded `APPROVED`. New entries arrive through the report queue and are `PENDING` until an
 * admin approves them (spec §8.2).
 *
 * `pattern` is a case-insensitive regular expression source for the wrong statement where one
 * can be written; those run in code (check T2). Every entry, pattern or not, is also given to
 * the examiner as data, which is how the `semantic` ones are found.
 */

export type PitfallSeed = {
  readonly code: string;
  readonly profile: string;
  readonly topic: string;
  readonly wrongPattern: string;
  readonly pattern?: string;
  readonly detection: 'regex' | 'semantic' | 'both';
  readonly correctStatement: string;
  readonly severity: 'blocking' | 'warning';
  readonly source: string;
};

const ENGINEERING = 'engineering_core_v1';
const SOURCE =
  'Evaluation of the AA7050 hybrid composite thesis, Chapter 1 (Developer Specification v1.0, 30 September 2026)';

export const PITFALL_SEED: readonly PitfallSeed[] = [
  {
    code: 'ENG-TRIB-001',
    profile: ENGINEERING,
    topic: 'friction',
    wrongPattern: 'Friction is independent of the normal load',
    pattern:
      'friction(?:al)?\\s+(?:force\\s+)?(?:is|remains|being)\\s+independent\\s+of\\s+(?:the\\s+)?(?:normal\\s+|applied\\s+)?load',
    detection: 'both',
    correctStatement:
      'Friction force is proportional to the normal load; it is the coefficient of friction that is independent of load (Amontons’ first law).',
    severity: 'blocking',
    source: SOURCE,
  },
  {
    code: 'ENG-EDM-001',
    profile: ENGINEERING,
    topic: 'EDM',
    wrongPattern: 'Deionised water is used in EDM to conduct electricity',
    pattern:
      'de-?ionis?z?ed\\s+water\\b[^.]{0,80}\\b(?:to\\s+)?conducts?\\s+(?:the\\s+)?(?:electricity|current)',
    detection: 'both',
    correctStatement:
      'Deionised water is the dielectric in wire EDM, chosen for its low conductivity; the discharge occurs when the dielectric breaks down.',
    severity: 'blocking',
    source: SOURCE,
  },
  {
    code: 'ENG-EDM-002',
    profile: ENGINEERING,
    topic: 'EDM',
    wrongPattern: 'Wire EDM is also called spark EDM',
    pattern:
      'wire\\s*(?:-cut\\s*)?EDM\\b[^.]{0,40}\\b(?:also\\s+)?(?:called|known\\s+as|termed)\\s+spark\\s+(?:EDM|erosion)',
    detection: 'both',
    correctStatement:
      'Spark erosion is EDM in general; wire EDM (WEDM) is the variant that uses a travelling wire electrode.',
    severity: 'blocking',
    source: SOURCE,
  },
  {
    code: 'ENG-SCC-001',
    profile: ENGINEERING,
    topic: 'stress corrosion cracking',
    wrongPattern: '"Statistically loaded" specimens',
    pattern: 'statistically\\s+loaded',
    detection: 'regex',
    correctStatement: 'Statically loaded.',
    severity: 'blocking',
    source: SOURCE,
  },
  {
    code: 'ENG-COMP-001',
    profile: ENGINEERING,
    topic: 'composites',
    wrongPattern: 'Continuous-fibre composites are isotropic, with marginal strength gain',
    pattern: 'continuous[\\s-]+fib(?:re|er)[^.]{0,80}\\bisotropic',
    detection: 'both',
    correctStatement:
      'That describes particle reinforcement. Continuous-fibre composites are anisotropic and give a large strength gain along the fibre direction.',
    severity: 'blocking',
    source: SOURCE,
  },
  {
    code: 'ENG-COMP-002',
    profile: ENGINEERING,
    topic: 'composites',
    wrongPattern: 'Poor wetting is due to the melting-point difference',
    pattern:
      'poor\\s+wett(?:ing|ability)[^.]{0,60}\\b(?:due\\s+to|because\\s+of|caused\\s+by)[^.]{0,40}melting[\\s-]+point',
    detection: 'both',
    correctStatement:
      'Poor wetting comes from high interfacial energy (a high contact angle) and oxide films on the melt or reinforcement, not from the melting-point difference.',
    severity: 'blocking',
    source: SOURCE,
  },
  {
    code: 'ENG-CHEM-001',
    profile: ENGINEERING,
    topic: 'flux chemistry',
    wrongPattern: '"K₂Br" used as a flux',
    pattern: 'K[₂2]Br\\b',
    detection: 'regex',
    correctStatement:
      'K₂Br is not a compound. The fluxes used are KBF₄ or K₂TiF₆; KBr is potassium bromide.',
    severity: 'blocking',
    source: SOURCE,
  },
  {
    code: 'ENG-PROP-001',
    profile: ENGINEERING,
    topic: 'material properties',
    wrongPattern: 'Graphite hardness given in the GPa ceramic range',
    detection: 'semantic',
    correctStatement:
      'Graphite is very soft (Mohs 1–2, Vickers well under 1 GPa); its softness is the basis of its use as a solid lubricant.',
    severity: 'blocking',
    source: SOURCE,
  },
  {
    code: 'ENG-PROP-002',
    profile: ENGINEERING,
    topic: 'material properties',
    wrongPattern: 'Ti₃Al hardness about 28 GPa',
    detection: 'semantic',
    correctStatement:
      'Ti₃Al is an intermetallic with a hardness of a few GPa, not a ceramic-range 28 GPa.',
    severity: 'blocking',
    source: SOURCE,
  },
  {
    code: 'ENG-PROC-001',
    profile: ENGINEERING,
    topic: 'powder metallurgy',
    wrongPattern: 'Powder metallurgy described as including melting and casting',
    pattern: 'powder\\s+metallurgy[^.]{0,100}\\b(?:melting|casting|molten)',
    detection: 'both',
    correctStatement:
      'Powder metallurgy is a solid-state route: blending, compaction and sintering, with no melting.',
    severity: 'blocking',
    source: SOURCE,
  },
  {
    code: 'ENG-PROC-002',
    profile: ENGINEERING,
    topic: 'casting',
    wrongPattern: 'Squeeze casting described as stirring in the mushy zone',
    pattern: 'squeeze\\s+casting[^.]{0,100}\\b(?:stirr(?:ed|ing)|mushy|semi[\\s-]solid)',
    detection: 'both',
    correctStatement:
      'Stirring in the mushy zone is compocasting. Squeeze casting is solidification of the melt under applied pressure.',
    severity: 'blocking',
    source: SOURCE,
  },
  {
    code: 'ENG-WEAR-001',
    profile: ENGINEERING,
    topic: 'wear',
    wrongPattern: 'Wear defined as sideways displacement of material',
    pattern:
      'wear\\s+(?:is|refers\\s+to|is\\s+defined\\s+as)[^.]{0,40}(?:sideways|lateral)\\s+displacement',
    detection: 'both',
    correctStatement:
      'Wear is the progressive loss of material from a surface by relative motion against another surface.',
    severity: 'blocking',
    source: SOURCE,
  },
  {
    code: 'ENG-WEAR-002',
    profile: ENGINEERING,
    topic: 'wear',
    wrongPattern: 'Corrosive wear equated with general atmospheric corrosion',
    detection: 'semantic',
    correctStatement:
      'Corrosive wear is material loss by combined chemical attack and mechanical action at a sliding contact, not general atmospheric corrosion.',
    severity: 'blocking',
    source: SOURCE,
  },
  {
    code: 'ENG-CORR-001',
    profile: ENGINEERING,
    topic: 'corrosion',
    wrongPattern: 'MnS inclusions discussed as a concern for maraging steel',
    pattern: 'MnS\\s+inclusions?[^.]{0,80}maraging',
    detection: 'both',
    correctStatement:
      'MnS inclusions are mainly a pitting concern in stainless steels; maraging steels are low-sulphur and the finding does not transfer.',
    severity: 'warning',
    source: SOURCE,
  },
  {
    code: 'ENG-CORR-002',
    profile: ENGINEERING,
    topic: 'stress corrosion cracking',
    wrongPattern:
      'Sulphide stress corrosion cracking (SSCC) claimed for aluminium with no application stated',
    detection: 'semantic',
    correctStatement:
      'SSCC is mainly a steel and sour-service (H₂S) phenomenon; a claim of SSCC for an aluminium alloy needs the application and environment justified.',
    severity: 'warning',
    source: SOURCE,
  },
];
