/**
 * Captions — one answer for every exporter and the compliance check.
 *
 * What was wrong before is the shape of these tests: a figure's caption was the uploaded file's
 * name, a table's was an attribute the node did not have, and a caption the student typed as a
 * paragraph was printed a second time under the exporter's own.
 */

import { describe, expect, it } from 'vitest';
import { captionOf, typedCaption, withCaption, withCaptionsResolved } from '../src/captions.js';

const image = (attrs: Record<string, unknown>) => ({ type: 'image', attrs });
const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('what a figure’s caption is', () => {
  it('is the caption the student wrote', () => {
    expect(captionOf(image({ caption: ' Survey sites ', alt: 'IMG_2034.png' }))).toBe(
      'Survey sites',
    );
  });

  it('is never the alt, which the editor set to the uploaded file’s name', () => {
    for (const alt of ['IMG_2034.png', 'plot.PNG', 'figure 3.jpeg', 'Drying curve']) {
      expect(captionOf(image({ alt })), alt).toBe('');
    }
  });

  it('is empty for a table with none, not "undefined"', () => {
    expect(captionOf({ type: 'table', attrs: {} })).toBe('');
    expect(captionOf({ type: 'table' })).toBe('');
  });
});

describe('the rendered label', () => {
  it('carries the caption after the template’s separator', () => {
    expect(withCaption('Figure {chapter}.{n}: {caption}', 'Survey sites')).toBe(
      'Figure {chapter}.{n}: Survey sites',
    );
  });

  it('drops the separator when there is no caption, rather than ending in a colon', () => {
    expect(withCaption('Figure 3.1: {caption}', '')).toBe('Figure 3.1');
    expect(withCaption('Table 2.1 – {caption}', '')).toBe('Table 2.1');
    expect(withCaption('Figure 3.1. {caption}', '')).toBe('Figure 3.1');
  });
});

describe('a caption the student typed as a paragraph', () => {
  it('is recognised by its shape: label, number, separator, words', () => {
    expect(typedCaption('Figure 2: Survey sites', 'figure')).toBe('Survey sites');
    expect(typedCaption('Fig. 3.1 – Drying curve', 'figure')).toBe('Drying curve');
    expect(typedCaption('Table 1. Sample sizes by district', 'table')).toBe(
      'Sample sizes by district',
    );
    expect(typedCaption('TABLE A2: Instruments', 'table')).toBe('Instruments');
  });

  it('is not a sentence that happens to begin with the word', () => {
    expect(typedCaption('Figure 2 shows the survey sites.', 'figure')).toBeNull();
    expect(typedCaption('Figures were adjusted for inflation.', 'figure')).toBeNull();
    expect(typedCaption('Table salt was used.', 'table')).toBeNull();
    expect(typedCaption('Figure 2: Survey sites', 'table')).toBeNull();
  });
});

describe('resolving captions in a chapter', () => {
  it('moves a typed caption into the figure after it, and out of the text', () => {
    const doc = {
      type: 'doc',
      content: [
        paragraph('The sites are shown below.'),
        image({ key: 'k', alt: 'IMG_1.png' }),
        paragraph('Figure 1: Survey sites'),
        paragraph('Uptake was lowest in the north.'),
      ],
    };
    const out = withCaptionsResolved(doc) as { content: Array<{ type: string; attrs?: unknown }> };
    expect(out.content.map((n) => n.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(out.content[1]?.attrs).toEqual({ key: 'k', alt: 'IMG_1.png', caption: 'Survey sites' });
  });

  it('takes the caption before a table when the template puts captions above', () => {
    const table = { type: 'table', attrs: { refId: 't1' }, content: [] };
    const out = withCaptionsResolved({
      type: 'doc',
      content: [paragraph('Table 1: Sample sizes'), table],
    }) as { content: Array<{ type: string; attrs?: unknown }> };
    expect(out.content).toHaveLength(1);
    expect(out.content[0]?.attrs).toEqual({ refId: 't1', caption: 'Sample sizes' });
  });

  it('leaves a figure that has its own caption, and the paragraph beside it, alone', () => {
    const doc = {
      type: 'doc',
      content: [image({ key: 'k', caption: 'Mine' }), paragraph('Figure 1: Another')],
    };
    expect(withCaptionsResolved(doc)).toEqual(doc);
  });

  it('does not take a paragraph carrying a citation, which would be lost with it', () => {
    const cited = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Figure 1: Sites, after ' },
        { type: 'citation', attrs: { sourceId: 's' } },
      ],
    };
    const doc = { type: 'doc', content: [image({ key: 'k' }), cited] };
    expect(withCaptionsResolved(doc)).toEqual(doc);
  });

  it('gives one paragraph to one figure, not to both its neighbours', () => {
    const out = withCaptionsResolved({
      type: 'doc',
      content: [image({ key: 'a' }), paragraph('Figure 1: Shared?'), image({ key: 'b' })],
    }) as { content: Array<{ attrs?: { caption?: string } }> };
    expect(out.content.map((n) => n.attrs?.caption)).toEqual(['Shared?', undefined]);
  });

  it('reaches figures inside a list or a quote', () => {
    const out = withCaptionsResolved({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [image({ key: 'k' }), paragraph('Figure 1: Deep')],
        },
      ],
    }) as { content: Array<{ content: Array<{ attrs?: { caption?: string } }> }> };
    expect(out.content[0]?.content).toHaveLength(1);
    expect(out.content[0]?.content[0]?.attrs?.caption).toBe('Deep');
  });
});
