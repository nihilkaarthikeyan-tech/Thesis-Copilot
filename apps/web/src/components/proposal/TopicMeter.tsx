'use client';

/**
 * The strength meter under the proposal's first message (docs/research/coverage-map.md row 3).
 * Pure client-side word lists (`lib/topic-strength.ts`); it reacts on every keystroke, never calls
 * a model, and never stops the student sending.
 */

import { scoreTopic, type TopicStrength } from '@/lib/topic-strength';

const LABEL: Record<TopicStrength, string> = {
  weak: 'Weak topic',
  fair: 'Fair topic',
  strong: 'Strong topic',
};

const FILLED: Record<TopicStrength, number> = { weak: 1, fair: 2, strong: 3 };

const TONE: Record<TopicStrength, string> = {
  weak: 'bg-warn',
  fair: 'bg-accent/60',
  strong: 'bg-accent',
};

export function TopicMeter({ text, example }: { text: string; example?: string }) {
  const score = scoreTopic(text);
  const empty = score.words === 0;
  return (
    <div className="border-t border-line px-3 py-2" data-testid="topic-meter">
      <div className="flex items-center gap-3">
        {/* The native meter is what a screen reader hears; the three bars are its picture. */}
        <meter
          className="sr-only"
          aria-label="Topic strength"
          min={0}
          max={3}
          value={empty ? 0 : FILLED[score.strength]}
          aria-valuetext={empty ? 'Nothing typed yet' : LABEL[score.strength]}
        />
        <div className="flex w-24 gap-1" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                !empty && n <= FILLED[score.strength] ? TONE[score.strength] : 'bg-line'
              }`}
            />
          ))}
        </div>
        <span className="text-xs font-semibold text-ink" data-testid="topic-strength">
          {empty ? 'Describe your topic' : LABEL[score.strength]}
        </span>
      </div>
      {!empty && score.hints.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 text-xs text-muted" data-testid="topic-hints">
          {score.hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      ) : null}
      {empty ? (
        <p className="mt-1.5 text-xs text-muted">
          A strong topic says what is studied, where or who, how, and what you want to find out.
          {example ? (
            <span className="mt-1 block" data-testid="topic-example">
              For example: {example}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
