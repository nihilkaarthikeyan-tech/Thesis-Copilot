/**
 * "You are 3 of 5 set up" — the shape of the whole job (2026-09-21).
 *
 * `NextAction` already says what to do *next*, and it is the better thing for a student who knows
 * the product. This answers a different question, and only really once: **what is this, and how
 * far through am I?** A thesis tool has a five-stage arc that nobody arriving for the first time
 * can see — propose, gather, outline, write, prepare to submit — and a new user's model of it is
 * whatever the first screen happened to show them.
 *
 * ## Why it is not a nag
 *
 * A checklist that never completes is a permanent accusation. This one is finite, each step is a
 * thing the product genuinely needs, and it is designed to be *finished and then gone*: the caller
 * hides it entirely once every step is done rather than displaying a row of ticks for ever.
 *
 * Steps are also **not ordered by force**. A student who starts writing before adding sources has
 * done step 4 and not step 2, and the checklist says exactly that rather than pretending step 4 is
 * unavailable. Real theses are not written in order.
 */

export type SetupStepId = 'proposal' | 'sources' | 'outline' | 'writing' | 'submission';

export type SetupStep = {
  id: SetupStepId;
  label: string;
  /** What it means, in one line, for somebody who has never seen the product. */
  blurb: string;
  done: boolean;
  /** Where to go and do it. Relative to the document. */
  href: string;
};

export type SetupProgress = {
  steps: SetupStep[];
  done: number;
  total: number;
  complete: boolean;
  /** The first step not yet done, for a single call to action. */
  next: SetupStep | null;
};

export type SetupFacts = {
  hasProposal: boolean;
  sources: number;
  /**
   * Every node in `DocumentMemory.outline`, children included — **not** `Chapter` rows.
   *
   * Two separate things seed structure before the student has built any, and the step has to
   * survive both:
   *
   *   - `POST /documents` creates one placeholder `Chapter` so the editor has somewhere to land,
   *     so counting chapter rows would tick this the moment a thesis was named.
   *   - Saving the proposal writes what FR-3.3 calls "a one-node tree" — the first chapter, mapped
   *     from the seed paper — so counting `outline.length > 0` ticks it at step 1 instead.
   *
   * Hence the count is the flattened tree and the threshold is *more than one*: more than the one
   * node the proposal seeds is the first moment any structure exists that the student chose.
   */
  outlineNodes: number;
  words: number;
  hasThesisDetails: boolean;
};

export function setupSteps(facts: SetupFacts, documentId: string): SetupProgress {
  const base = `/app/d/${documentId}`;
  const steps: SetupStep[] = [
    {
      id: 'proposal',
      label: 'Say what the thesis is about',
      blurb: 'A working title and the problem you are addressing. Every later suggestion reads it.',
      done: facts.hasProposal,
      href: `${base}/proposal`,
    },
    {
      id: 'sources',
      label: 'Add some sources',
      blurb: 'Upload the papers you are working from. Nothing can be cited that is not here.',
      done: facts.sources > 0,
      href: `${base}/sources`,
    },
    {
      id: 'outline',
      label: 'Build the chapter outline',
      blurb: 'The chapter tree. You can change it at any time — it is a plan, not a commitment.',
      // See `outlineNodes`: one node is what saving the proposal leaves behind, not an outline.
      done: facts.outlineNodes > 1,
      href: `${base}/outline`,
    },
    {
      id: 'writing',
      label: 'Write something',
      blurb: 'Open a chapter and start. Suggestions appear as you type, grounded in your sources.',
      done: facts.words > 0,
      href: `${base}/outline`,
    },
    {
      id: 'submission',
      label: 'Fill in the submission details',
      blurb: 'Your university, degree and supervisor, and the formatting template to match.',
      done: facts.hasThesisDetails,
      href: `${base}/submit`,
    },
  ];

  const done = steps.filter((step) => step.done).length;
  return {
    steps,
    done,
    total: steps.length,
    complete: done === steps.length,
    // The first *undone* step in arc order, which is not necessarily the first unticked one a
    // student would choose — but it is the one that unblocks the most of what follows.
    next: steps.find((step) => !step.done) ?? null,
  };
}
