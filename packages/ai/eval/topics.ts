/**
 * The theses the prompt evaluation writes for (ADR-0038). Five fields, so a prompt that only
 * works for engineering does not win. `edm-hastelloy` is the reviewer's own topic and
 * `slm-maraging` the topic of the Jenni sample he compared us with.
 *
 * The student text in each case is written the way a student would open a paragraph, and makes
 * no factual claim of its own: everything factual must come from the real papers.
 */

export type Topic = {
  id: string;
  thesisTitle: string;
  /** The OpenAlex search that found the papers. */
  search: string;
  chapter: { title: string; scopeNote: string };
  /** Text before the cursor, for autocomplete cases. */
  befores: string[];
  /** A section to draft. */
  section: { title: string; scopeNote: string };
  /** Questions a student would ask the chat about their library. */
  questions: string[];
  /** A paragraph in a student's casual first-draft register, for the formalise command. */
  informal: string;
  /** What a student types to start the proposal conversation. */
  idea: string;
  /** Literature themes and source counts for the outline's gap map; the last is thin. */
  themes: string[];
};

export const TOPICS: Topic[] = [
  {
    id: 'edm-hastelloy',
    thesisTitle:
      'Composite versus conventional electrodes in electrical discharge machining of Hastelloy',
    search: 'electrical discharge machining Hastelloy electrode wear',
    chapter: {
      title: 'Literature Review',
      scopeNote:
        'Prior work on electrode materials, electrode wear and surface integrity in EDM of nickel-based superalloys, and where a comparison of composite and conventional electrodes is missing.',
    },
    befores: [
      'Electrical discharge machining is widely used for nickel-based superalloys such as Hastelloy, which are difficult to cut by conventional means.',
      'The choice of electrode material shapes both the cost and the quality of the process. Electrode wear is one of the main concerns.',
      'Surface integrity after machining is the second concern this review examines.',
    ],
    section: {
      title: 'Electrode materials and wear in EDM of nickel-based alloys',
      scopeNote:
        'What studies report about copper, graphite and composite electrodes: tool wear rate, material removal rate, the parameters that drive them, and gaps for Hastelloy.',
    },
    questions: [
      'Which electrode material gives the lowest tool wear in these studies?',
      'What process parameters most affect material removal rate?',
    ],
    informal:
      "So basically EDM is used a lot for really hard alloys like Hastelloy because normal cutting just doesn't work well. The electrode matters a lot and people keep looking at which one wears less.",
    idea: 'I want to do something on EDM of Hastelloy, maybe comparing electrodes.',
    themes: [
      'Electrode materials and tool wear',
      'Process parameters and material removal rate',
      'Surface integrity of nickel-based superalloys',
    ],
  },
  {
    id: 'slm-maraging',
    thesisTitle: 'Corrosion behaviour of maraging steel produced by selective laser melting',
    search: 'selective laser melting maraging steel corrosion',
    chapter: {
      title: 'Literature Review',
      scopeNote:
        'Microstructure of laser powder bed fused maraging steel, the effect of heat treatment, and its corrosion behaviour.',
    },
    befores: [
      'Selective laser melting can produce maraging steel parts with complex geometry directly from powder.',
      'Heat treatment after printing changes the microstructure of these parts.',
      'Corrosion resistance is less studied than mechanical strength.',
    ],
    section: {
      title: 'Microstructure and corrosion of additively manufactured maraging steel',
      scopeNote:
        'What studies report about as-built and heat-treated microstructure, austenite reversion, and corrosion in chloride environments.',
    },
    questions: [
      'How does heat treatment change the microstructure of printed maraging steel?',
      'What do these studies say about corrosion of SLM maraging steel?',
    ],
    informal:
      'SLM lets you print maraging steel parts with pretty complicated shapes, and after that you usually heat treat them, which changes a lot about how the metal behaves.',
    idea: 'My idea is corrosion of 3D printed maraging steel.',
    themes: [
      'As-built microstructure of SLM maraging steel',
      'Heat treatment and austenite reversion',
      'Corrosion in chloride environments',
    ],
  },
  {
    id: 'rooftop-solar-india',
    thesisTitle: 'Why rural households delay rooftop solar adoption in India',
    search: 'rooftop solar adoption barriers households India',
    chapter: {
      title: 'Literature Review',
      scopeNote:
        'Barriers and drivers of residential rooftop solar adoption: cost, subsidies, awareness, trust and policy.',
    },
    befores: [
      'India has set ambitious targets for rooftop solar, but household uptake has been slow.',
      'Financial barriers are the most frequently discussed.',
      'Beyond cost, trust in installers and awareness of schemes also matter.',
    ],
    section: {
      title: 'Barriers to household rooftop solar adoption',
      scopeNote:
        'What studies find about upfront cost, subsidies and finance, awareness, and institutional or policy barriers.',
    },
    questions: [
      'What are the main barriers households face in adopting rooftop solar?',
      'Do subsidies actually increase adoption according to these papers?',
    ],
    informal:
      "Lots of people in India still haven't put solar on their roofs even though the government wants them to, and money is a big reason but not the only one.",
    idea: "I'm interested in why people in villages don't install rooftop solar.",
    themes: [
      'Upfront cost, subsidies and finance',
      'Awareness and trust in installers',
      'Policy and institutional barriers',
    ],
  },
  {
    id: 'mhealth-diabetes',
    thesisTitle: 'Adherence to mobile health applications for type 2 diabetes self-management',
    search: 'mobile health app type 2 diabetes self-management adherence',
    chapter: {
      title: 'Literature Review',
      scopeNote:
        'Evidence on mobile apps for type 2 diabetes self-management: effect on glycaemic control, engagement and adherence, and what drives continued use.',
    },
    befores: [
      'Mobile health applications have been proposed as a low-cost support for diabetes self-management.',
      'Their effect on glycaemic control has been measured in several trials.',
      'Engagement tends to fall after the first weeks of use.',
    ],
    section: {
      title: 'Effectiveness and engagement of diabetes self-management apps',
      scopeNote:
        'What studies report about HbA1c outcomes, engagement over time, and the features linked to sustained use.',
    },
    questions: [
      'Do diabetes apps reduce HbA1c, and by how much?',
      'Why do people stop using diabetes apps?',
    ],
    informal:
      'Diabetes apps sound like a cheap way to help people manage their sugar, but a lot of users kind of drop off after a few weeks, so it is not clear how much they really help.',
    idea: 'Something about diabetes apps and whether patients keep using them.',
    themes: [
      'Effect of apps on HbA1c',
      'Engagement and attrition over time',
      'Features linked to sustained use',
    ],
  },
  {
    id: 'microfinance-women',
    thesisTitle: "Microfinance and women's entrepreneurship in India",
    search: 'microfinance women entrepreneurship empowerment India',
    chapter: {
      title: 'Literature Review',
      scopeNote:
        "Evidence on microfinance and women's enterprise outcomes, empowerment, and the limits of credit alone.",
    },
    befores: [
      "Microfinance has long been promoted as a route to women's economic empowerment.",
      'Access to credit is only part of the picture.',
      'Self-help groups are a common delivery model in India.',
    ],
    section: {
      title: "Microfinance and women's enterprise outcomes",
      scopeNote:
        'What studies find about business growth, household decision-making and empowerment, and why credit alone may not be enough.',
    },
    questions: [
      "Does microfinance increase women's decision-making power at home?",
      'Why is credit alone not enough for women entrepreneurs?',
    ],
    informal:
      "Microfinance gets pushed a lot as a way to empower women, but just giving loans doesn't seem to be the whole story, and self-help groups are the usual way it works in India.",
    idea: 'I want to study microfinance and women entrepreneurs in India.',
    themes: [
      'Credit and business outcomes',
      'Household decision-making and empowerment',
      'Self-help groups and the limits of credit alone',
    ],
  },
];

/**
 * The copying round (ADR-0075, 2026-10-05): the production case from the side-by-side study.
 * Its papers come from Crossref (`fetch-crossref.ts`), Bagla (2026) first. Kept out of `TOPICS`
 * so the earlier rounds' case sets, and the drafted sections they read, stay as they were.
 * The first `befores` entry is the sentence typed in production on 2026-10-05.
 */
/**
 * The one sentence of Bagla (2026, Results, p. 11) we hold verbatim: the passage production's
 * suggestion copied, as recorded from production in `packages/retrieval/test/paraphrase.spec.ts`
 * (ADR-0071). Added to the Karnataka cases as a second chunk of the same paper; nothing else of
 * the full text is reproduced here.
 */
export const BAGLA_P11 =
  'Although Karnataka has one of India’s most progressive distributed solar policy frameworks, ' +
  'household-level evidence shows that adoption remains constrained by informational gaps, ' +
  'procedural complexity, structural limitations, and perceived financial risk.';

export const KARNATAKA: Topic = {
  id: 'rooftop-solar-karnataka',
  thesisTitle: 'Barriers to rooftop solar adoption among rural households in Karnataka',
  search: 'rooftop solar adoption households Karnataka India barriers subsidy',
  chapter: {
    title: 'Literature Review',
    scopeNote:
      'Why household rooftop solar adoption stays low in India and Karnataka despite subsidies: cost and finance, information, procedures, roof space and trust.',
  },
  befores: [
    'Rooftop solar adoption among rural households in Karnataka remains low despite state subsidies.',
    'Upfront cost is usually named first among the barriers.',
    'The subsidy itself is not always experienced as a benefit.',
  ],
  section: {
    title: 'Household frictions in rooftop solar adoption',
    scopeNote:
      'What studies find about the information, procedural, structural and financial frictions households meet between awareness and installation, and how subsidies are experienced.',
  },
  questions: ['What stops willing households from installing rooftop solar?'],
  informal:
    'Even with the subsidy a lot of households in Karnataka never get rooftop solar installed, and the paperwork and roof space seem to matter as much as the money.',
  idea: 'Why households in Karnataka do not install rooftop solar even with subsidies.',
  themes: [
    'Cost, finance and subsidies',
    'Information and procedural frictions',
    'Roof space and structural constraints',
  ],
};
