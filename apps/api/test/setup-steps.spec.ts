/**
 * The setup checklist.
 *
 * The design risk is that it becomes a nag, so most of these pin the ways it is meant to stay out
 * of the way: it completes, it reports completion so the caller can remove it, and it does not
 * pretend a student who wrote before adding sources has done something wrong.
 */

import { describe, expect, it } from 'vitest';
import { type SetupFacts, setupSteps } from '../src/modules/documents/setup-steps.js';

const DOC = '01a0-doc';

const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({
  hasProposal: false,
  sources: 0,
  outlineNodes: 0,
  words: 0,
  hasThesisDetails: false,
  ...over,
});

const doneIds = (f: SetupFacts) =>
  setupSteps(f, DOC)
    .steps.filter((s) => s.done)
    .map((s) => s.id);

describe('a brand new thesis', () => {
  it('has nothing done and points at the proposal', () => {
    const progress = setupSteps(facts(), DOC);
    expect(progress.done).toBe(0);
    expect(progress.total).toBe(5);
    expect(progress.complete).toBe(false);
    expect(progress.next?.id).toBe('proposal');
  });

  it('gives every step somewhere to go', () => {
    for (const step of setupSteps(facts(), DOC).steps) {
      expect(step.href.startsWith(`/app/d/${DOC}/`)).toBe(true);
    }
  });
});

describe('what marks a step done', () => {
  it('counts a saved proposal', () => {
    expect(doneIds(facts({ hasProposal: true }))).toEqual(['proposal']);
  });

  it('counts any source at all', () => {
    expect(doneIds(facts({ sources: 1 }))).toEqual(['sources']);
  });

  it('counts an outline once the tree has nodes in it', () => {
    expect(doneIds(facts({ outlineNodes: 6 }))).toEqual(['outline']);
  });

  it('does not count the placeholder chapter every new thesis is born with', () => {
    // `POST /documents` creates one `Chapter` row so the editor has somewhere to land, and the
    // outline record stays `[]` until somebody builds a tree. Counting chapters here would tick
    // step 3 the moment a thesis was named — which is why the fact is outline nodes.
    expect(doneIds(facts())).toEqual([]);
  });

  it('does not count the one-node tree that saving the proposal leaves behind', () => {
    // FR-3.3: `PUT /memory/scope` writes the first chapter mapped from the seed paper. That is
    // the proposal's own output, not an outline the student built, and it was ticking step 3 at
    // step 1 until an E2E run read "2 of 5" straight after saving a proposal.
    expect(doneIds(facts({ hasProposal: true, outlineNodes: 1 }))).toEqual(['proposal']);
    expect(doneIds(facts({ hasProposal: true, outlineNodes: 2 }))).toEqual(['proposal', 'outline']);
  });

  it('counts writing only when there are words, not just chapters', () => {
    // An outline creates empty chapters; that is step 3, not step 4.
    expect(doneIds(facts({ outlineNodes: 6, words: 0 }))).toEqual(['outline']);
    expect(doneIds(facts({ outlineNodes: 6, words: 120 }))).toEqual(['outline', 'writing']);
  });

  it('counts the submission details', () => {
    expect(doneIds(facts({ hasThesisDetails: true }))).toEqual(['submission']);
  });
});

describe('out of order', () => {
  it('accepts a student who wrote before adding sources', () => {
    // Real theses are not written in order, and a checklist that insists otherwise is wrong
    // about the work rather than about the student.
    const progress = setupSteps(facts({ outlineNodes: 3, words: 900 }), DOC);
    expect(doneIds(facts({ outlineNodes: 3, words: 900 }))).toEqual(['outline', 'writing']);
    expect(progress.done).toBe(2);
  });

  it('still names the earliest missing step, because it unblocks the most', () => {
    const progress = setupSteps(facts({ outlineNodes: 3, words: 900 }), DOC);
    expect(progress.next?.id).toBe('proposal');
  });
});

describe('finishing', () => {
  it('reports complete so the caller can take it off the screen', () => {
    const all = facts({
      hasProposal: true,
      sources: 4,
      outlineNodes: 6,
      words: 20_000,
      hasThesisDetails: true,
    });
    const progress = setupSteps(all, DOC);
    expect(progress.complete).toBe(true);
    expect(progress.done).toBe(progress.total);
    // Nothing left to point at: a checklist that keeps suggesting something is never finished.
    expect(progress.next).toBeNull();
  });
});
