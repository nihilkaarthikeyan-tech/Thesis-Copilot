/** The "As a table" edit action's parser (ADR-0081): a pipe table in, cells out, or nothing. */

import { describe, expect, it } from 'vitest';
import { parseMarkdownTable } from '../src/components/editor/table-from-markdown';

describe('parseMarkdownTable', () => {
  it('reads a header, the rule and the rows, padding short rows and trimming cells', () => {
    const table = parseMarkdownTable(
      [
        '| Study | Sample | Finding | Source |',
        '| --- | --- | --- | --- |',
        '| Kumar | 312 households | cost first | {{cite:S1#c1}} |',
        '| Bagla | — | friction |',
        '|  |  |  |  |',
      ].join('\n'),
    );
    expect(table).toEqual({
      header: ['Study', 'Sample', 'Finding', 'Source'],
      rows: [
        ['Kumar', '312 households', 'cost first', '{{cite:S1#c1}}'],
        ['Bagla', '—', 'friction', ''],
      ],
    });
  });

  it('is nothing for prose, or a table without a rule', () => {
    expect(parseMarkdownTable('Upfront cost was the main barrier.')).toBeNull();
    expect(parseMarkdownTable('| a | b |\n| 1 | 2 |')).toBeNull();
  });
});
