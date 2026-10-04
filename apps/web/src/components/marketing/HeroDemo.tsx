'use client';

/**
 * The hero's suggestion card, played rather than pictured (2026-10-05, ADR-0059 row 101: Jenni
 * shows its autocomplete working on the home page). Scripted from fixed text — no model call, no
 * account, nothing sent anywhere. It types the student's sentence, streams the grey suggestion
 * word by word with its citation, "presses" Tab, and the suggestion becomes the student's text;
 * then it waits and plays again.
 *
 * A visitor who asks for reduced motion sees the finished frame, still and complete. The card is
 * decorative (aria-hidden), as the still picture was; the page's words carry the meaning.
 */

import { useEffect, useState } from 'react';

const OWN = '…households that could afford a rooftop system still delay the decision.';
const GHOST =
  'This chapter examines the gap between affordability and uptake, using the factors identified in prior work';
const GHOST_WORDS = GHOST.split(' ');
const CITE = '(Shakeel et al., 2023)';

type Frame = { typed: number; words: number; cite: boolean; pressed: boolean; kept: boolean };

const FINAL: Frame = {
  typed: OWN.length,
  words: GHOST_WORDS.length,
  cite: true,
  pressed: false,
  kept: true,
};

/** The script: each step is a frame and how long it holds, in milliseconds. */
function script(): Array<[Frame, number]> {
  const steps: Array<[Frame, number]> = [];
  const base: Frame = { typed: 0, words: 0, cite: false, pressed: false, kept: false };
  for (let i = 0; i <= OWN.length; i += 3) {
    steps.push([{ ...base, typed: Math.min(i, OWN.length) }, 28]);
  }
  steps.push([{ ...base, typed: OWN.length }, 700]);
  for (let w = 1; w <= GHOST_WORDS.length; w++) {
    steps.push([{ ...base, typed: OWN.length, words: w }, 70]);
  }
  const shown: Frame = { ...base, typed: OWN.length, words: GHOST_WORDS.length, cite: true };
  steps.push([shown, 1600]);
  steps.push([{ ...shown, pressed: true }, 350]);
  steps.push([{ ...shown, kept: true }, 3200]);
  return steps;
}

export function HeroDemo() {
  const [frame, setFrame] = useState<Frame>(FINAL);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const steps = script();
    let i = 0;
    let timer: number;
    const tick = () => {
      const step = steps[i];
      if (!step) {
        i = 0;
        timer = window.setTimeout(tick, 400);
        return;
      }
      setFrame(step[0]);
      i += 1;
      timer = window.setTimeout(tick, step[1]);
    };
    timer = window.setTimeout(tick, 600);
    return () => window.clearTimeout(timer);
  }, []);

  const ghost = GHOST_WORDS.slice(0, frame.words).join(' ');
  return (
    <div className="mk-frag mk-frag-write" aria-hidden="true" data-testid="hero-demo">
      <div className="mk-frag-doc">
        {OWN.slice(0, frame.typed)}
        {frame.words === 0 ? <span className="mk-caret" /> : null}
        {ghost ? <span className={frame.kept ? 'mk-kept' : 'mk-ghost'}> {ghost}</span> : null}
        {frame.cite ? (
          <>
            {' '}
            <span className="mk-cite">{CITE}</span>
          </>
        ) : null}
        {frame.words > 0 ? <span className="mk-caret" /> : null}
      </div>
      <div className="mk-frag-bar">
        <span className={frame.pressed ? 'mk-key-pressed' : undefined}>
          <kbd>Tab</kbd> {frame.kept ? 'kept' : 'keep'}
        </span>
        <span>
          <kbd>Esc</kbd> dismiss
        </span>
        <span className="mk-push">Cites your library only</span>
      </div>
    </div>
  );
}
