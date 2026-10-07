import { describe, expect, it } from 'vitest';
import {
  buildCommandRequest,
  buildEditReasonsRequest,
  COMMAND,
  COMMAND_LABELS,
  citationMoved,
  citationsBeforeStop,
  claimWords,
  cleanEditReasons,
  EDIT_ACTIONS,
  editReasonsUserMessage,
  fitToSelection,
  isEditAction,
  mockCommandFor,
  postProcessCommand,
  saysNothingChanged,
  sendsPassages,
} from '../src/builder/command.js';
import { loadPrompt } from '../src/prompts.js';

const input = (command: (typeof EDIT_ACTIONS)[number] | 'formalise') => ({
  command,
  memoryBlock: 'MEMORY',
  selection: 'The survey shows cost is the main barrier {{cite:k1}}.',
  contextBefore: '',
  contextAfter: '',
  passages: [
    { id: 'S1#c1', shortRef: 'Rao 2021', page: null, text: 'Cost was not the main barrier.' },
  ],
  userId: 'u',
  documentId: 'd',
});

describe('edit actions beyond the section commands (ADR-0066)', () => {
  it('each has a label and runs on the edit prompt; the A.11 five keep the command prompt', () => {
    for (const action of EDIT_ACTIONS) {
      expect(isEditAction(action)).toBe(true);
      expect(COMMAND_LABELS[action].label.length).toBeGreaterThan(0);
      const req = buildCommandRequest(input(action) as never);
      expect(req.system.cached).toContain(loadPrompt('edit').system);
      expect(req.action).toBe('COMMAND');
    }
    const formalise = buildCommandRequest(input('formalise') as never);
    expect(formalise.system.cached).toContain(loadPrompt('command').system);
    expect(formalise.system.cached).not.toContain(loadPrompt('edit').system);
    expect(loadPrompt('edit').raw).toContain('NOT FROM PRD APPENDIX A');
  });

  it('only counter is sent passages, as expand is', () => {
    expect(COMMAND.needsPassages).toContain('counter');
    for (const action of ['hedge', 'direct', 'active', 'past', 'present'] as const) {
      expect(COMMAND.needsPassages).not.toContain(action);
    }
  });

  it('the grounding check applies unchanged: a citation not sent is stripped, a dropped one reported', () => {
    const out = postProcessCommand(
      'The survey suggests cost is a barrier {{cite:k1}} {{cite:S9#c9}}.',
      input('hedge').selection,
      [],
    );
    expect(out.hallucinated).toEqual(['S9#c9']);
    expect(out.text).not.toContain('S9#c9');
    const dropped = postProcessCommand(
      'The survey suggests cost is a barrier.',
      input('hedge').selection,
      [],
    );
    expect(dropped.dropped).toEqual(['k1']);
  });

  it('the mock hedges and makes direct mechanically, and keeps every citation', () => {
    const ask = (command: string, selection: string) =>
      mockCommandFor({
        messages: [
          { content: `<command>${command}</command>\n\n<selection>\n${selection}\n</selection>` },
        ],
      });
    expect(ask('hedge', 'The survey shows X {{cite:k1}}.')).toBe(
      'The survey suggests X {{cite:k1}}.',
    );
    expect(ask('direct', 'It could perhaps be argued that X {{cite:k1}}.')).toBe('X {{cite:k1}}.');
    expect(ask('past', 'The study finds X.')).toBe('The study finds X.');
  });
});

describe('translate and table (ADR-0081)', () => {
  it('translate names its one target, the thesis language, and nothing else', async () => {
    const { buildCommandRequest, languageName } = await import('../src/builder/command.js');
    const req = buildCommandRequest({
      ...input('translate'),
      language: 'hi',
    });
    expect(req.messages[0]?.content).toContain('<target_language>Hindi</target_language>');
    expect(buildCommandRequest(input('translate')).messages[0]?.content).toContain(
      '<target_language>English</target_language>',
    );
    expect(languageName('ta-IN')).toBe('Tamil');
    expect(languageName('xx')).toBe('xx');
    expect(buildCommandRequest(input('hedge')).messages[0]?.content).not.toContain(
      '<target_language>',
    );
  });

  it('the mock builds a table with a row per sentence and the citations in their own column', async () => {
    const { mockCommandFor } = await import('../src/builder/command.js');
    const text = mockCommandFor({
      messages: [
        {
          content:
            '<command>table</command>\n<selection>\nCost was first {{cite:S1#c1}}. Credit came second.\n</selection>',
        },
      ],
    });
    expect(text.split('\n')).toEqual([
      '| Finding | Source |',
      '| --- | --- |',
      '| Cost was first. | {{cite:S1#c1}} |',
      '| Credit came second. |  |',
    ]);
  });
});

describe('a rewrite fits the edges of what was selected (2026-10-06)', () => {
  it('drops the full stop a mid-sentence selection did not have, and keeps its spacing', () => {
    // The demo video: the selection stopped at "norms " and the paragraph read "norms.that".
    const selection =
      'Mobile banking could widen access, yet barriers include socio-cultural norms ';
    const out = postProcessCommand(
      'Mobile banking may widen access; however, barriers include socio-cultural norms.',
      selection,
      [],
    );
    expect(out.text).toBe(
      'Mobile banking may widen access; however, barriers include socio-cultural norms ',
    );
  });

  it('keeps the full stop when the selection ended a sentence', () => {
    expect(fitToSelection('Uptake remains uneven.', 'Uptake is uneven.')).toBe(
      'Uptake remains uneven.',
    );
    expect(fitToSelection('Uptake remains uneven.', 'Uptake is uneven {{cite:S1#c1}}.')).toBe(
      'Uptake remains uneven.',
    );
  });

  it('starts in lower case where the selection began mid-sentence, but not for a name', () => {
    expect(
      fitToSelection('Limited digital literacy constrains use.', 'low digital skills hinder use'),
    ).toBe('limited digital literacy constrains use');
    expect(fitToSelection('UPI adoption lags.', 'upi use lags')).toBe('UPI adoption lags');
    expect(fitToSelection('FinTech services lag.', 'fintech services lag')).toBe(
      'FinTech services lag',
    );
  });

  it('keeps leading space, leaves an ellipsis and a table alone', () => {
    expect(fitToSelection('the potential grows.', ' the potential is large')).toBe(
      ' the potential grows',
    );
    expect(fitToSelection('and so on...', 'and so on')).toBe('and so on...');
    const table = '| A | B |\n|---|---|\n| 1 | 2 |';
    expect(fitToSelection(table, 'some text ')).toBe(table);
  });
});

describe('the AI edit panel (ADR-0095, Jenni build plan R8)', () => {
  it('names every new action in the edit prompt, and has no general paraphrase (§12.3)', () => {
    const system = loadPrompt('edit').system;
    for (const action of [
      'flow',
      'transitions',
      'redundancy',
      'strengthen',
      'precise',
      'future',
      'bullets',
      'numbered',
      'prose',
      'custom',
    ] as const) {
      expect(EDIT_ACTIONS).toContain(action);
      expect(system).toContain(`- ${action}:`);
    }
    expect(EDIT_ACTIONS as readonly string[]).not.toContain('paraphrase');
    expect(system).toMatch(/harder to recognise as AI-written/);
  });

  it("sends the student's instruction for custom, capped, and passages only when given", () => {
    const withLibrary = buildCommandRequest({
      ...input('custom'),
      instruction: `Make the second sentence shorter.${'x'.repeat(COMMAND.maxInstructionChars)}`,
    });
    const message = String(withLibrary.messages[0]?.content);
    expect(message).toContain('<instruction>\nMake the second sentence shorter.');
    expect(message).toContain('S1#c1');
    expect(/<instruction>\n([\s\S]*?)\n<\/instruction>/.exec(message)?.[1]?.length).toBe(
      COMMAND.maxInstructionChars,
    );
    const noLibrary = buildCommandRequest({ ...input('custom'), passages: [], instruction: 'x' });
    expect(String(noLibrary.messages[0]?.content)).not.toContain('<passage ');
    expect(sendsPassages('custom', [])).toBe(false);
    expect(sendsPassages('flow', [{}])).toBe(false);
    expect(sendsPassages('counter', [])).toBe(true);
  });

  it('removes a citation written twice, keeping its first place', () => {
    const selection = 'Cost is the main barrier {{cite:k1}}. Credit helps {{cite:k2}}.';
    // Side by side, the existing same-source collapse already merges them.
    expect(
      postProcessCommand('Cost is the main barrier {{cite:k1}}{{cite:k1}}.', selection, [], 'flow')
        .text,
    ).toBe('Cost is the main barrier {{cite:k1}}.');
    // Apart, the copy on the other claim goes, and it is reported.
    const out = postProcessCommand(
      'Cost is the main barrier {{cite:k1}}, and credit helps {{cite:k2}} {{cite:k1}}.',
      selection,
      [],
      'flow',
    );
    expect(out.text).toBe('Cost is the main barrier {{cite:k1}}, and credit helps {{cite:k2}}.');
    expect(out.doubled).toEqual(['k1']);
    expect(out.dropped).toEqual([]);
  });

  it('reports a citation moved to another claim, and not one kept on its claim', () => {
    const selection =
      'Upfront cost limits adoption {{cite:k1}}. Subsidy approval delays installation {{cite:k2}}.';
    const moved = postProcessCommand(
      'Upfront cost limits adoption. Subsidy approval may delay installation {{cite:k1}} {{cite:k2}}.',
      selection,
      [],
      'hedge',
    );
    expect(moved.moved).toEqual(['k1']);
    const kept = postProcessCommand(
      'Upfront cost appears to limit adoption {{cite:k1}}. Subsidy approval can delay installation {{cite:k2}}.',
      selection,
      [],
      'hedge',
    );
    expect(kept.moved).toEqual([]);
    // A translation shares no words with its source; it is not checked.
    expect(
      postProcessCommand('लागत {{cite:k1}}। देरी {{cite:k2}}।', selection, [], 'translate').moved,
    ).toEqual([]);
  });

  it('claim words are the content words of the sentence before the marker', () => {
    expect([
      ...claimWords('Rain fell. Upfront costs limit rural adoption {{cite:k1}}.', 'k1'),
    ]).toEqual(['upfro', 'costs', 'limit', 'rural', 'adopt']);
    expect(claimWords('No marker here.', 'k1').size).toBe(0);
  });

  it('the mock writes lists one sentence per item', () => {
    const req = buildCommandRequest({
      ...input('numbered'),
      selection: 'Cost matters {{cite:k1}}. Credit helps.',
    });
    expect(
      mockCommandFor({ messages: req.messages as unknown as Array<{ content: string }> }),
    ).toBe('1. Cost matters {{cite:k1}}.\n2. Credit helps.');
  });

  it('asks for reasons with the edit, before and after, on the fast tier, inside COMMAND', () => {
    const req = buildEditReasonsRequest({
      command: 'custom',
      instruction: 'Shorter, please',
      before: 'A long sentence.',
      after: 'Short.',
      userId: 'u',
      documentId: 'd',
    });
    expect(req.tier).toBe('fast');
    expect(req.action).toBe('COMMAND');
    expect(String(req.messages[0]?.content)).toBe(
      '<edit>custom: Shorter, please</edit>\n\n<before>\nA long sentence.\n</before>\n\n<after>\nShort.\n</after>',
    );
    expect(editReasonsUserMessage({ command: 'flow', before: 'a', after: 'b' })).toContain(
      '<edit>flow (Fix the flow)</edit>',
    );
  });

  it('keeps at most four reasons, without list markers, and a point that starts with a figure', () => {
    expect(
      cleanEditReasons([
        '- Split a sentence.',
        '  ',
        '2. Added "however".',
        '38% stays.',
        'e',
        'f',
      ]),
    ).toEqual(['Split a sentence.', 'Added "however".', '38% stays.', 'e']);
  });
});

describe('a citation after the full stop (ADR-0095, seen on Strengthen)', () => {
  it('goes back before the stop, and is not reported as moved', () => {
    expect(citationsBeforeStop('Costs fell. {{cite:k1}} Credit rose. {{cite:k2}}{{cite:k3}}')).toBe(
      'Costs fell {{cite:k1}}. Credit rose {{cite:k2}}{{cite:k3}}.',
    );
    const selection = 'Upfront cost limits adoption {{cite:k1}}. Credit helps {{cite:k2}}.';
    const out = postProcessCommand(
      'The data indicate that upfront cost limits adoption. {{cite:k1}} Credit access helps. {{cite:k2}} Together these suggest a route.',
      selection,
      [],
      'strengthen',
    );
    expect(out.text).toBe(
      'The data indicate that upfront cost limits adoption {{cite:k1}}. Credit access helps {{cite:k2}}. Together these suggest a route.',
    );
    expect(out.moved).toEqual([]);
  });

  it('a claim word is found in the sentence before a citation that follows its stop', () => {
    expect([...claimWords('Upfront costs limit adoption. {{cite:k1}} Next.', 'k1')]).toContain(
      'upfro',
    );
  });
});

describe('a repeated citation that is part of a sentence (ADR-0095, seen on Strengthen)', () => {
  it('stays, and is reported, rather than leaving "the findings in."', () => {
    const out = postProcessCommand(
      'The evidence in {{cite:k3}} shows delays matter. This complements the findings in {{cite:k3}} on cost.',
      'Delays are an important barrier {{cite:k3}}.',
      [],
      'strengthen',
    );
    expect(out.text).toContain('the findings in {{cite:k3}} on cost');
    expect(out.repeated).toEqual(['k3']);
  });

  it('is removed at the end of a clause, even before another citation', () => {
    const out = postProcessCommand(
      'Delays matter {{cite:k3}}. Cost matters too {{cite:k3}}{{cite:k4}}.',
      'Delays matter {{cite:k3}}. Cost matters {{cite:k4}}.',
      [],
      'flow',
    );
    expect(out.text).toBe('Delays matter {{cite:k3}}. Cost matters too {{cite:k4}}.');
    expect(out.repeated).toEqual([]);
    expect(out.doubled).toEqual(['k3']);
  });
});

describe('reasons that only say nothing changed are dropped (ADR-0095)', () => {
  it.each([
    'Check: The factual content and citations remain unchanged between versions.',
    'The citation remains correctly placed, supporting the claim about awareness.',
    'No facts or citations were added or removed, so the content remains consistent.',
    'Maintained all original facts and citations without omission or addition.',
    'Check: The citation placement remains the same, supporting each claim respectively.',
  ])('drops: %s', (reason) => {
    expect(saysNothingChanged(reason)).toBe(true);
  });

  it.each([
    "Combined two sentences with a semicolon and 'consequently' to clarify the causal link.",
    'Check: The cautious tone suggesting uncertainty was removed, which may affect the nuance.',
    'Check: The example from Kerala mentioned in the instruction was not added.',
    'Check: The after text adds new interpretive content not present in the before text.',
    "Added 'To investigate this,' to link the argument to the interviews.",
  ])('keeps: %s', (reason) => {
    expect(saysNothingChanged(reason)).toBe(false);
  });
});

describe('a citation moved onto the neighbouring sentence (real model, Fix the flow, 2026-10-07)', () => {
  const selection =
    'The urban heat island effect in Chennai results from rapid urbanization and heat-retaining materials, which keep temperatures higher at night. This nocturnal temperature elevation exacerbates thermal discomfort and increases heat strain among outdoor workers during work and rest periods {{cite:a}}{{cite:b}}.';

  it('is reported when another sentence matches its claim clearly better', () => {
    const rewrite =
      'Rapid urbanization and heat-retaining materials keep temperatures higher at night in Chennai {{cite:a}}{{cite:b}}. This nocturnal warmth therefore increases thermal discomfort and heat strain among outdoor workers during work and rest periods.';
    expect(citationMoved(selection, rewrite, 'a')).toBe(true);
    expect(postProcessCommand(rewrite, selection, [], 'flow').moved).toEqual(['a', 'b']);
  });

  it('is not reported when it stays on its rewritten claim', () => {
    const rewrite =
      'Rapid urbanization and heat-retaining materials keep temperatures higher at night in Chennai. This nocturnal warmth therefore increases thermal discomfort and heat strain among outdoor workers during work and rest periods {{cite:a}}{{cite:b}}.';
    expect(citationMoved(selection, rewrite, 'a')).toBe(false);
    expect(postProcessCommand(rewrite, selection, [], 'flow').moved).toEqual([]);
  });
});
