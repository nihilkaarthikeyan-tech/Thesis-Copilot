/**
 * Cross-reference numbering.
 *
 * The whole point is what happens when the document changes, so most of these insert something
 * and check that the numbers moved. The one that matters most is the deleted-target case: a
 * reference to a figure that no longer exists must look broken, because a plausible wrong number
 * is the failure nobody catches before submission.
 */

import { describe, expect, it } from 'vitest';
import {
  formatRef,
  type NumberedTarget,
  numberingMap,
  numberTargets,
  refIdOf,
} from '../src/cross-ref.js';

const para = (text = 'words') => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const figure = (refId: string) => ({ type: 'image', attrs: { refId } });
const table = (refId: string) => ({ type: 'table', attrs: { refId }, content: [] });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

const indexOf = (targets: NumberedTarget[], refId: string) =>
  targets.find((t) => t.refId === refId)?.index;

describe('finding the targets', () => {
  it('numbers figures in the order they appear', () => {
    const targets = numberTargets(doc(figure('a'), para(), figure('b'), figure('c')));
    expect(targets.map((t) => t.refId)).toEqual(['a', 'b', 'c']);
    expect(targets.map((t) => t.index)).toEqual([1, 2, 3]);
  });

  it('counts figures and tables separately', () => {
    // Figure 3.1 and Table 3.1 both exist; neither displaces the other.
    const targets = numberTargets(doc(figure('f1'), table('t1'), figure('f2')));
    expect(indexOf(targets, 'f1')).toBe(1);
    expect(indexOf(targets, 't1')).toBe(1);
    expect(indexOf(targets, 'f2')).toBe(2);
  });

  it('finds a figure nested inside other blocks', () => {
    const nested = doc({ type: 'blockquote', content: [figure('deep')] });
    expect(numberTargets(nested).map((t) => t.refId)).toEqual(['deep']);
  });

  it('falls back to an image’s storage key when it has no refId', () => {
    // Documents written before cross-references existed still number correctly.
    const old = doc({ type: 'image', attrs: { key: 'figures/doc/ch/x.png' } });
    expect(numberTargets(old)[0]?.refId).toBe('figures/doc/ch/x.png');
  });

  it('returns null for a node with neither', () => {
    expect(refIdOf({ type: 'image', attrs: {} })).toBeNull();
  });
});

describe('what happens when the document changes', () => {
  it('renumbers everything after an inserted figure', () => {
    // This is the failure the feature exists for: the student inserts a figure and every
    // hand-typed reference after it silently becomes wrong.
    const before = numberingMap(doc(figure('a'), figure('b')));
    const after = numberingMap(doc(figure('new'), figure('a'), figure('b')));
    expect(before.get('b')?.index).toBe(2);
    expect(after.get('b')?.index).toBe(3);
  });

  it('renumbers after a deletion too', () => {
    const after = numberingMap(doc(figure('b')));
    expect(after.get('b')?.index).toBe(1);
  });

  it('still counts a figure that cannot be pointed at', () => {
    // An id-less figure occupies a number; skipping it would shift every figure after it.
    const targets = numberTargets(doc({ type: 'image', attrs: {} }, figure('b')));
    expect(targets.map((t) => t.refId)).toEqual(['b']);
    expect(indexOf(targets, 'b')).toBe(2);
  });
});

describe('what a reference reads as', () => {
  const targets = numberingMap(doc(figure('a'), figure('b')));

  it('carries the chapter number', () => {
    expect(formatRef(targets.get('b'), 3, 'figure')).toBe('Figure 3.2');
  });

  it('labels a table as a table', () => {
    const withTable = numberingMap(doc(table('t')));
    expect(formatRef(withTable.get('t'), 2, 'table')).toBe('Table 2.1');
  });

  it('shows an obvious gap when the target is gone, never a plausible number', () => {
    expect(formatRef(undefined, 3, 'figure')).toBe('[Figure — deleted]');
    expect(formatRef(undefined, 3, 'figure')).not.toMatch(/\d\.\d/);
  });
});
