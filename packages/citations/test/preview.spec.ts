/**
 * The style preview: one in-text citation and one bibliography entry for a fixed example
 * reference, through the same citeproc pass a thesis uses.
 */

import { describe, expect, it } from 'vitest';
import { previewStyle, SAMPLE_LABEL, SAMPLE_REFERENCE } from '../src/preview.js';
import { STYLES } from '../src/styles.js';

describe('previewStyle', () => {
  it('renders APA as author–date', () => {
    const preview = previewStyle('apa');
    expect(preview.styleId).toBe('apa');
    expect(preview.family).toBe('author-date');
    expect(preview.noteStyle).toBe(false);
    expect(preview.inText).toBe('(Example & Sample, 2024)');
    expect(preview.bibliography).toContain('Example, A., & Sample, R. (2024)');
    expect(preview.bibliography).toContain('Journal of Example Studies');
  });

  it('renders IEEE as a number', () => {
    const preview = previewStyle('ieee');
    expect(preview.family).toBe('numeric');
    expect(preview.inText).toBe('[1]');
    expect(preview.bibliography).toContain('A. Example');
  });

  it('renders every shipped style without an empty line', () => {
    for (const style of STYLES) {
      const preview = previewStyle(style.id);
      expect(preview.inText, style.id).not.toBe('');
      expect(preview.bibliography, style.id).not.toBe('');
    }
  });

  it('labels the sample as an example and gives it no identifier', () => {
    expect(previewStyle('harvard').sampleLabel).toBe(SAMPLE_LABEL);
    expect(SAMPLE_LABEL).toMatch(/not a real paper/);
    const csl = SAMPLE_REFERENCE.cslJson as Record<string, unknown>;
    expect(csl.title).toMatch(/example/i);
    expect(csl.DOI).toBeUndefined();
    expect(csl.URL).toBeUndefined();
  });
});
