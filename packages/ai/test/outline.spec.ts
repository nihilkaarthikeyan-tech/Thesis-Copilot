/**
 * Outline generation and the templates — PRD A.9, FR-3.1, FR-3.2, FR-3.6; PHASES v2 W8 and B3.5,
 * "Tests owed (week 8)".
 *
 *   "`suggestTemplate`, `renderTemplateBlock`. `normaliseOutline` (ids unique and slug-shaped),
 *    `enforceTemplateShape` (restores a dropped chapter, folds extras), the A.9 mock against a gap
 *    map and an extraction."
 *
 * `enforceTemplateShape` is the one that protects a student from a quiet loss. A model that skips
 * Methodology produces an outline that reads fine and is missing a required chapter; a model that
 * invents a ninth chapter produces one that will not pass the department's shape. Both have to be
 * fixed **visibly** — the restored chapter says in its own scope note that it came from the
 * template.
 */

import { renderTemplateBlock, suggestTemplate, TEMPLATE_SPECS } from '@tc/config';
import type { OutlineNode } from '@tc/types';
import { describe, expect, it } from 'vitest';
import {
  enforceTemplateShape,
  normaliseOutline,
  readOutlineResult,
  roleForChapter,
} from '../src/builder/outline.js';
import {
  buildSectionScopeRequest,
  mockSectionScopeResponse,
  sectionScopeSchema,
  sectionScopeUserMessage,
} from '../src/builder/section-scope.js';

const node = (title: string, scopeNote = 'A note.', children: OutlineNode[] = []): OutlineNode => ({
  id: '',
  title,
  scopeNote,
  children,
});

describe('FR-3.1 — suggestTemplate', () => {
  it('defaults to STEM_EMPIRICAL when the field is unknown or empty', () => {
    for (const field of [null, undefined, '', '   ', 'Mechanical Engineering']) {
      expect(suggestTemplate(field)).toBe('STEM_EMPIRICAL');
    }
  });

  it('suggests QUALITATIVE for the humanities and social sciences', () => {
    for (const field of ['Sociology', 'Educational Psychology', 'Media and Communication', 'Law']) {
      expect(suggestTemplate(field), field).toBe('QUALITATIVE');
    }
  });

  it('suggests COMPILATION when the field names the format itself', () => {
    for (const field of ['Physics (thesis by publication)', 'article-based thesis']) {
      expect(suggestTemplate(field), field).toBe('COMPILATION');
    }
  });

  it('prefers COMPILATION over QUALITATIVE when both match — the format is the stronger signal', () => {
    expect(suggestTemplate('Sociology, thesis by publication')).toBe('COMPILATION');
  });
});

describe('A.9 — renderTemplateBlock', () => {
  it('names the template and lists every chapter with its intent', () => {
    const block = renderTemplateBlock('STEM_EMPIRICAL');
    const spec = TEMPLATE_SPECS.STEM_EMPIRICAL;
    expect(block).toContain(`<template name="${spec.name}"`);
    expect(block).toContain(`chapter_count="${spec.chapters.length}"`);
    for (const chapter of spec.chapters) {
      expect(block).toContain(chapter.title);
      expect(block).toContain(chapter.intent);
    }
    expect(block.trimEnd().endsWith('</template>')).toBe(true);
  });

  it('says "flexible" rather than a number for a flexible template', () => {
    const flexible = (['STEM_EMPIRICAL', 'QUALITATIVE', 'COMPILATION'] as const).find(
      (t) => TEMPLATE_SPECS[t].flexibleChapterCount,
    );
    if (!flexible) return; // No flexible template in the spec set; nothing to assert.
    expect(renderTemplateBlock(flexible)).toContain('chapter_count="flexible"');
  });
});

describe('A.9 — normaliseOutline', () => {
  it('gives every node a slug-shaped id', () => {
    const out = normaliseOutline([
      node('Introduction'),
      node('Literature Review & Gaps', 'A note.', [node('Solar dryers (2015—2024)')]),
    ]);
    for (const n of [...out, ...out.flatMap((c) => c.children)]) {
      expect(n.id, n.title).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('makes duplicate ids unique instead of letting one overwrite the other', () => {
    const out = normaliseOutline([
      { id: 'ch1', title: 'Introduction', scopeNote: '', children: [] },
      { id: 'ch1', title: 'Background', scopeNote: '', children: [] },
    ]);
    expect(out[0]?.id).toBe('ch1');
    expect(out[1]?.id).not.toBe('ch1');
    expect(new Set(out.map((n) => n.id)).size).toBe(2);
  });

  it('keeps a usable id the model supplied', () => {
    const out = normaliseOutline([
      { id: 'methodology', title: 'Methodology', scopeNote: '', children: [] },
    ]);
    expect(out[0]?.id).toBe('methodology');
  });

  it('replaces an id that is not slug-shaped', () => {
    const out = normaliseOutline([
      { id: 'Chapter One!', title: 'Introduction', scopeNote: '', children: [] },
    ]);
    expect(out[0]?.id).toMatch(/^[a-z0-9-]+$/);
    expect(out[0]?.id).not.toBe('Chapter One!');
  });

  it('trims titles and scope notes', () => {
    const out = normaliseOutline([node('  Introduction  ', '  A note.  ')]);
    expect(out[0]?.title).toBe('Introduction');
    expect(out[0]?.scopeNote).toBe('A note.');
  });

  it('reaches every level of the tree', () => {
    const out = normaliseOutline([
      node('Introduction', 'x', [node('Background', 'x', [node('History', 'x')])]),
    ]);
    expect(out[0]?.children[0]?.children[0]?.id).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('A.9 — readOutlineResult', () => {
  const one = [{ id: 'ch1', title: 'Introduction', scopeNote: 'A note.', children: [] }];

  it('accepts each wrapper the model might use', () => {
    for (const value of [one, { outline: one }, { nodes: one }]) {
      expect(readOutlineResult(value), JSON.stringify(value)).toHaveLength(1);
    }
  });

  it('returns nothing rather than guessing when the shape is wrong', () => {
    for (const value of [null, 'text', { chapters: one }, 42]) {
      expect(readOutlineResult(value)).toEqual([]);
    }
  });
});

describe('A.9 — enforceTemplateShape', () => {
  const template = 'STEM_EMPIRICAL' as const;
  const spec = TEMPLATE_SPECS[template];

  it('leaves a well-shaped outline alone, in the template order', () => {
    const out = enforceTemplateShape(
      normaliseOutline(spec.chapters.map((c) => node(c.title))),
      template,
    );
    expect(out.map((n) => n.title)).toEqual(spec.chapters.map((c) => c.title));
  });

  it('restores a dropped chapter and says in the scope note where it came from', () => {
    const withoutSecond = spec.chapters.filter((_, i) => i !== 1).map((c) => node(c.title));
    const out = enforceTemplateShape(normaliseOutline(withoutSecond), template);
    expect(out).toHaveLength(spec.chapters.length);
    const restored = out[1];
    expect(restored?.title).toBe(spec.chapters[1]?.title);
    expect(restored?.scopeNote).toContain('added from the template');
  });

  it('folds an extra chapter into the one before it rather than losing it', () => {
    const withExtra = [...spec.chapters.map((c) => node(c.title)), node('An extra chapter')];
    const out = enforceTemplateShape(normaliseOutline(withExtra), template);
    expect(out).toHaveLength(spec.chapters.length);
    expect(out.at(-1)?.children.map((c) => c.title)).toContain('An extra chapter');
  });

  it('matches a chapter the model renamed loosely', () => {
    const renamed = spec.chapters.map((c, i) =>
      node(i === 0 ? `${c.title} and Motivation` : c.title),
    );
    const out = enforceTemplateShape(normaliseOutline(renamed), template);
    expect(out[0]?.title).toBe(`${spec.chapters[0]?.title} and Motivation`);
    expect(out[0]?.scopeNote).not.toContain('added from the template');
  });

  it('leaves a flexible-count template untouched', () => {
    const flexible = (['STEM_EMPIRICAL', 'QUALITATIVE', 'COMPILATION'] as const).find(
      (t) => TEMPLATE_SPECS[t].flexibleChapterCount,
    );
    if (!flexible) return;
    const three = normaliseOutline([node('One'), node('Two'), node('Three')]);
    expect(enforceTemplateShape(three, flexible)).toHaveLength(3);
  });

  it('still gives every node a unique id afterwards', () => {
    const out = enforceTemplateShape(
      normaliseOutline([node(spec.chapters[0]?.title ?? 'Introduction'), node('An extra')]),
      template,
    );
    const ids = [...out, ...out.flatMap((n) => n.children)].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('roleForChapter', () => {
  it('reads the role off the template by position', () => {
    const spec = TEMPLATE_SPECS.STEM_EMPIRICAL;
    spec.chapters.forEach((chapter, i) => {
      expect(roleForChapter('STEM_EMPIRICAL', i)).toBe(chapter.role);
    });
  });

  it('falls back rather than throwing past the end of the template', () => {
    expect(roleForChapter('STEM_EMPIRICAL', 99)).toBe('DISCUSSION');
  });
});

describe('FR-3.6 — per-section scope regeneration', () => {
  const input = {
    scope: {
      workingTitle: 'A low-cost forced-convection solar dryer for coastal fish',
      problemStatement: 'Open-air drying loses a fifth of the catch.',
      objectives: ['Design the dryer', 'Measure drying curves'],
    },
    node: { id: 'ch3', title: 'Design and methodology', scopeNote: 'The dryer and the rig.' },
    siblings: [
      {
        title: 'Literature review',
        scopeNote: 'Published dryer designs.',
        position: 'before' as const,
      },
      { title: 'Results', scopeNote: 'Drying curves by season.', position: 'after' as const },
    ],
    userId: 'u',
    documentId: 'd',
  };

  it('puts the siblings in the prompt on the right side of the target', () => {
    const message = sectionScopeUserMessage(input);
    const before = message.indexOf('<chapters_before>');
    const target = message.indexOf('<target');
    const after = message.indexOf('<chapters_after>');
    expect(before).toBeGreaterThanOrEqual(0);
    expect(target).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(target);
    expect(message.slice(before, target)).toContain('Literature review');
    expect(message.slice(after)).toContain('Results');
  });

  it('asks for the target chapter only', () => {
    expect(sectionScopeUserMessage(input)).toContain('for the target chapter only');
  });

  it("carries the student's own instruction when they gave one", () => {
    const message = sectionScopeUserMessage({
      ...input,
      instruction: 'Narrow this to forced-convection dryers only.',
    });
    expect(message).toContain('<instruction>Narrow this to forced-convection dryers only.');
  });

  it('is an OUTLINE request on the Strong tier', () => {
    const request = buildSectionScopeRequest(input);
    expect(request.action).toBe('OUTLINE');
    expect(request.tier).toBe('strong');
  });

  it('the mock answers within the schema and invents no topic', () => {
    const request = { action: 'OUTLINE', messages: [{ content: sectionScopeUserMessage(input) }] };
    expect(mockSectionScopeResponse.match(request)).toBe(true);
    const result = mockSectionScopeResponse.respond(request);
    expect(() => sectionScopeSchema.parse(result)).not.toThrow();
    expect(result.title).toBe(input.node.title);
    expect(result.scopeNote).toContain('mock');
  });

  it('does not intercept a whole-outline request', () => {
    expect(
      mockSectionScopeResponse.match({
        action: 'OUTLINE',
        messages: [{ content: '<scope>…</scope>\n<template name="STEM">' }],
      }),
    ).toBe(false);
  });
});
