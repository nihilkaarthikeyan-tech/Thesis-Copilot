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
  },
];
