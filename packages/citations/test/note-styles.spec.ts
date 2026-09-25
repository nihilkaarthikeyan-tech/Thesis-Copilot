/**
 * Note styles — ADR-0029. A footnote style writes each citation as a note, and needs to know
 * which note it is: that is how the second citation of a source becomes the short form, and a
 * citation right after another of the same source becomes "Ibid.".
 *
 * The catalogue's note styles are fetched from the CSL repository when chosen, and a unit test
 * does not reach the network. So this registers a minimal note-class style written for the test —
 * full form, short form, "ibid." — under a real catalogue id, through the same `registerStyleXml`
 * the API uses for a fetched style. The real Chicago style is exercised in the browser test.
 */

import { describe, expect, it } from 'vitest';
import { citationNodesIn, notesIn } from '../src/checks.js';
import { isNoteStyle, renderCitations } from '../src/render.js';
import { findStyle, registerStyleXml } from '../src/styles.js';

const STYLE = 'chicago-notes-bibliography-16th-edition';

const TEST_NOTES_CSL = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="note" version="1.0" default-locale="en-US">
  <info>
    <title>Test notes</title>
    <id>http://example.invalid/test-notes</id>
    <updated>2026-09-25T00:00:00+00:00</updated>
  </info>
  <citation>
    <layout suffix=".">
      <choose>
        <if position="ibid"><text value="Ibid"/></if>
        <else-if position="subsequent">
          <names variable="author"><name form="short"/></names>
          <text variable="title" form="short" prefix=", "/>
        </else-if>
        <else>
          <names variable="author"><name/></names>
          <text variable="title" prefix=", "/>
          <date variable="issued" prefix=" (" suffix=")"><date-part name="year"/></date>
        </else>
      </choose>
    </layout>
  </citation>
  <bibliography>
    <layout>
      <names variable="author"><name name-as-sort-order="first"/></names>
      <text variable="title" prefix=". "/>
    </layout>
  </bibliography>
</style>`;

const entry = findStyle(STYLE);
if (!entry) throw new Error(`${STYLE} is not in the catalogue`);
registerStyleXml(entry.xmlId ?? STYLE, TEST_NOTES_CSL);

const KUMAR = {
  id: 's1',
  title: 'Drip irrigation in rural Karnataka',
  authors: [{ family: 'Kumar', given: 'Anil' }],
  year: 2021,
};
const RAO = {
  id: 's2',
  title: 'Subsidy timing',
  authors: [{ family: 'Rao', given: 'Priya' }],
  year: 2019,
};

describe('a note style', () => {
  it('is recognised from its CSL class', () => {
    expect(isNoteStyle(entry)).toBe(true);
    expect(isNoteStyle(findStyle('apa') as NonNullable<ReturnType<typeof findStyle>>)).toBe(false);
  });

  it('writes the full note first, then "Ibid.", then the short form', () => {
    const result = renderCitations({
      style: STYLE,
      sources: [KUMAR, RAO],
      citations: [
        { key: 'a', sourceId: 's1', noteIndex: 1 },
        { key: 'b', sourceId: 's1', noteIndex: 2 },
        { key: 'c', sourceId: 's2', noteIndex: 3 },
        { key: 'd', sourceId: 's1', noteIndex: 4 },
      ],
    });
    expect(result.noteStyle).toBe(true);
    expect(result.labels.a).toBe('Anil Kumar, Drip irrigation in rural Karnataka (2021).');
    expect(result.labels.b).toBe('Ibid.');
    expect(result.labels.c).toBe('Priya Rao, Subsidy timing (2019).');
    expect(result.labels.d).toBe('Kumar, Drip irrigation in rural Karnataka.');
  });

  it('does not say "Ibid." across a note of the student’s own in between', () => {
    // Notes 1 and 3 cite Kumar; note 2 is the student's footnote, so 3 is not "ibid." of 1.
    const result = renderCitations({
      style: STYLE,
      sources: [KUMAR],
      citations: [
        { key: 'a', sourceId: 's1', noteIndex: 1 },
        { key: 'b', sourceId: 's1', noteIndex: 3 },
      ],
    });
    expect(result.labels.b).not.toBe('Ibid.');
  });

  it('leaves an in-text style exactly as it was', () => {
    const result = renderCitations({
      style: 'apa',
      sources: [KUMAR],
      citations: [{ key: 'a', sourceId: 's1', noteIndex: 7 }],
    });
    expect(result.noteStyle).toBe(false);
    expect(result.labels.a).toBe('(Kumar, 2021)');
  });
});

describe('counting a chapter’s notes', () => {
  const chapter = {
    id: 'c',
    title: 'Results',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'One' },
            { type: 'citation', attrs: { key: 'k1', sourceId: 's1' } },
            { type: 'footnote', attrs: { text: 'An aside.' } },
            { type: 'text', text: ' two' },
            { type: 'citation', attrs: { key: 'k2', sourceId: 's1' } },
          ],
        },
      ],
    },
  };

  it('counts the student’s footnotes and the citations together, in order', () => {
    expect(citationNodesIn(chapter).map((n) => n.noteOrdinal)).toEqual([1, 3]);
    expect(notesIn(chapter)).toBe(3);
  });
});
