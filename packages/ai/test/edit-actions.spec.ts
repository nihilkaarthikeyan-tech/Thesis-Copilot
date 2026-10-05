import { describe, expect, it } from 'vitest';
import {
  buildCommandRequest,
  COMMAND,
  COMMAND_LABELS,
  EDIT_ACTIONS,
  isEditAction,
  mockCommandFor,
  postProcessCommand,
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
