/**
 * Equations as Word equations (2026-09-25). The mapping is checked on the XML Word reads; how it
 * looks is checked by eye through the PDF converter (see docs/BUILD_LOG.md).
 */

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { chapterToDocx } from '../src/docx.js';
import { latexToWordMath, parseXml } from '../src/word-math.js';

async function documentXml(latex: string, display = false): Promise<string> {
  const node = display
    ? { type: 'mathBlock', attrs: { latex } }
    : { type: 'paragraph', content: [{ type: 'mathInline', attrs: { latex } }] };
  const zip = await JSZip.loadAsync(
    await chapterToDocx({ type: 'doc', content: [node] }, { title: 'Maths' }),
  );
  return (await zip.file('word/document.xml')?.async('string')) ?? '';
}

describe('an equation in the Word export', () => {
  it('is a Word equation, not its LaTeX source', async () => {
    const xml = await documentXml('E = mc^2');
    expect(xml).toContain('<m:oMath>');
    expect(xml).toContain('<m:sSup>');
    expect(xml).not.toContain('mc^2');
  });

  it('builds fractions, roots and sub- and superscripts from their parts', async () => {
    const xml = await documentXml('\\frac{\\alpha + 1}{\\sqrt{x_i^2}}', true);
    expect(xml).toContain('<m:f>');
    expect(xml).toContain('<m:rad>');
    expect(xml).toContain('<m:sSubSup>');
    // Symbols arrive as characters, not as TeX commands.
    expect(xml).toContain('α');
    expect(xml).not.toContain('\\alpha');
  });

  it('puts a sum’s bounds under and over it', async () => {
    const xml = await documentXml('\\sum_{i=1}^{n} x_i', true);
    expect(xml).toContain('∑');
    expect(xml).toContain('<m:limLow>');
    expect(xml).toContain('<m:limUpp>');
  });

  it('prints what it cannot typeset faithfully as the LaTeX, not as a wrong equation', async () => {
    expect(latexToWordMath('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')).toBeNull();
    const xml = await documentXml('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}');
    expect(xml).not.toContain('<m:oMath>');
    expect(xml).toContain('pmatrix');
  });

  it('prints invalid LaTeX as the student wrote it', () => {
    expect(latexToWordMath('\\frac{a}{')).toBeNull();
    expect(latexToWordMath('   ')).toBeNull();
  });
});

describe('the small XML reader', () => {
  it('reads entities, self-closing tags and nesting', () => {
    const root = parseXml('<a x="1&amp;2"><b/>&lt;&#x3B1;&#946;</a>');
    const a = root.children[0] as { attrs: Record<string, string>; children: unknown[] };
    expect(a.attrs.x).toBe('1&2');
    expect(a.children[1]).toBe('<αβ');
  });
});
