/**
 * R27 (ADR-0121): the layout presets and the advanced options, resolved to the numbers the file
 * and the preview are both built from.
 */

import { describe, expect, it } from 'vitest';
import { applyLayout, exportLayoutSchema, resolveLayout } from '../src/export-layout.js';
import { readTemplateSpec } from '../src/template.js';

const SPEC = readTemplateSpec({
  page: { size: 'A4', marginsMm: { top: 25, bottom: 25, left: 38, right: 25 } },
  font: { body: 'Times New Roman', sizePt: 12, lineSpacing: 1.5 },
  frontMatter: [
    { id: 'TITLE_PAGE' },
    { id: 'CERTIFICATE' },
    { id: 'DECLARATION' },
    { id: 'ABSTRACT' },
    { id: 'TOC' },
    { id: 'LIST_OF_FIGURES' },
  ],
});

describe('the presets', () => {
  it('thesis is the template exactly, and the only one PAGE_SETUP passes', () => {
    const thesis = resolveLayout(SPEC, { preset: 'thesis' });
    expect(thesis).toMatchObject({
      paper: 'A4',
      marginsMm: { top: 25, bottom: 25, left: 38, right: 25 },
      font: 'Times New Roman',
      sizePt: 12,
      lineSpacing: 1.5,
      columns: 1,
      titlePage: true,
      contents: true,
      matchesTemplate: true,
    });
    for (const preset of ['default', 'double', 'two-column'] as const) {
      expect(resolveLayout(SPEC, { preset }).matchesTemplate).toBe(false);
    }
  });

  it('double-spaced, two-column and plain carry their own setup', () => {
    expect(resolveLayout(SPEC, { preset: 'double' })).toMatchObject({
      font: 'Times New Roman',
      sizePt: 12,
      lineSpacing: 2,
      marginsMm: { top: 25.4, left: 25.4 },
      titlePage: false,
      columns: 1,
    });
    expect(resolveLayout(SPEC, { preset: 'two-column' })).toMatchObject({
      sizePt: 10,
      columns: 2,
      marginsMm: { top: 19.05 },
    });
    // The plain preset is in the student's font style (ADR-0120).
    expect(resolveLayout(SPEC, { preset: 'default' }).font).toBe('Calibri');
    expect(resolveLayout(SPEC, { preset: 'default' }, { fontStyle: 'serif' }).font).toBe(
      'Times New Roman',
    );
  });
});

describe('the advanced options', () => {
  it('override the preset, and a changed template setup no longer matches it', () => {
    const changed = resolveLayout(SPEC, {
      preset: 'thesis',
      paper: 'Letter',
      font: 'Arial',
      sizePt: 11,
      lineSpacing: 2,
      margins: 'wide',
      titlePage: false,
      pageNumbers: false,
      comments: true,
    });
    expect(changed).toMatchObject({
      paper: 'Letter',
      font: 'Arial',
      sizePt: 11,
      lineSpacing: 2,
      marginsMm: { top: 38.1, bottom: 38.1, left: 38.1, right: 38.1 },
      titlePage: false,
      pageNumbers: false,
      comments: true,
      matchesTemplate: false,
    });
    // A title page or the comments alone do not change the page setup.
    expect(
      resolveLayout(SPEC, { preset: 'thesis', titlePage: false, comments: true }),
    ).toMatchObject({ matchesTemplate: true });
  });

  it('cannot turn the contents off when a chapter has a contents block', () => {
    const layout = resolveLayout(
      SPEC,
      { preset: 'double', contents: false },
      { contentsBlock: true },
    );
    expect(layout).toMatchObject({ contents: true, contentsForced: true });
  });

  it('refuses a size or spacing the dialog does not offer', () => {
    expect(exportLayoutSchema.safeParse({ preset: 'thesis', sizePt: 13 }).success).toBe(false);
    expect(exportLayoutSchema.safeParse({ preset: 'thesis', lineSpacing: 3 }).success).toBe(false);
    expect(exportLayoutSchema.safeParse({ preset: 'poster' }).success).toBe(false);
    expect(exportLayoutSchema.safeParse({ preset: 'two-column', sizePt: 10 }).success).toBe(true);
  });
});

describe('applyLayout', () => {
  it('writes the numbers into the spec and keeps the template front matter for a thesis', () => {
    const spec = applyLayout(SPEC, resolveLayout(SPEC, { preset: 'thesis', titlePage: false }));
    expect(spec.frontMatter.map((s) => s.id)).toEqual([
      'CERTIFICATE',
      'DECLARATION',
      'ABSTRACT',
      'TOC',
      'LIST_OF_FIGURES',
    ]);
    expect(spec.font.body).toBe('Times New Roman');
  });

  it('keeps only the abstract for a manuscript, and adds what is turned on', () => {
    const plain = applyLayout(SPEC, resolveLayout(SPEC, { preset: 'double' }));
    expect(plain.frontMatter.map((s) => s.id)).toEqual(['ABSTRACT']);
    expect(plain.font).toMatchObject({ body: 'Times New Roman', sizePt: 12, lineSpacing: 2 });
    expect(plain.page.marginsMm.left).toBe(25.4);
    const withBoth = applyLayout(
      SPEC,
      resolveLayout(SPEC, { preset: 'two-column', titlePage: true, contents: true }),
    );
    expect(withBoth.frontMatter.map((s) => s.id)).toEqual(['TITLE_PAGE', 'ABSTRACT', 'TOC']);
  });
});
