'use client';

import {
  BadgeCheck,
  Library,
  ListOrdered,
  type LucideIcon,
  Mic,
  PenLine,
  Presentation,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';

type Step = {
  id: string;
  label: string;
  Icon: LucideIcon;
  body: ReactNode;
  image: string;
  alt: string;
  path: string;
};

/**
 * The product tour: pick a stage on the left, see its real screen on the right.
 *
 * Every image is a screenshot of the product itself, taken from the sample thesis (rooftop solar
 * adoption in Karnataka), so the page shows what a student will actually see.
 */
const STEPS: readonly Step[] = [
  {
    id: 'write',
    label: 'Write',
    Icon: PenLine,
    body: (
      <>
        Press <kbd>Ctrl</kbd> <kbd>/</kbd> for a suggestion. It stays grey until you press{' '}
        <kbd>Tab</kbd>, and it can only cite what's in your library.
      </>
    ),
    image: '/landing/screens/hero-editor.webp',
    alt: 'The editor, with a grey suggestion at the end of a paragraph and the sources beside it',
    path: 'chapter-1 · write',
  },
  {
    id: 'sources',
    label: 'Sources',
    Icon: Library,
    body: 'Add PDFs, import from Zotero or paste a DOI. Every paper is labelled by how much of it was actually read.',
    image: '/landing/screens/library.webp',
    alt: 'The sources library with four papers, each labelled by how much was read',
    path: 'sources',
  },
  {
    id: 'outline',
    label: 'Outline',
    Icon: ListOrdered,
    body: 'Chapters, word counts, and how much you wrote yourself against how much you accepted from AI.',
    image: '/landing/screens/outline.webp',
    alt: 'The outline with progress: words, chapters, share written by the student',
    path: 'outline',
  },
  {
    id: 'guide',
    label: 'Guide',
    Icon: Presentation,
    body: 'Your guide comments on the exact passage and sees the same record you do.',
    image: '/landing/screens/guide.webp',
    alt: "The supervisor's view of a shared chapter, with a comment box",
    path: 'shared · guide view',
  },
  {
    id: 'submit',
    label: 'Submit',
    Icon: BadgeCheck,
    body: "Ten checks against your university's template before you export.",
    image: '/landing/screens/checks.webp',
    alt: 'The submission checks, listing what is left to fix',
    path: 'submit',
  },
  {
    id: 'viva',
    label: 'Viva',
    Icon: Mic,
    body: 'Examiner questions about paragraphs you wrote, with feedback on your answer.',
    image: '/landing/screens/viva.webp',
    alt: 'Viva preparation with an examiner-style question and an answer box',
    path: 'viva',
  },
];

export function ProductTour() {
  const [active, setActive] = useState(STEPS[0]?.id ?? 'write');
  const step = STEPS.find((s) => s.id === active) ?? STEPS[0];
  if (!step) return null;

  return (
    <div className="mk-tour">
      <div className="mk-steps" role="tablist" aria-label="Stages of a thesis">
        {STEPS.map(({ id, label, Icon, body }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tour-tab-${id}`}
            aria-selected={id === active}
            aria-controls="tour-panel"
            className="mk-step"
            onClick={() => setActive(id)}
          >
            <span className="mk-step-h">
              <Icon aria-hidden="true" strokeWidth={1.75} />
              {label}
            </span>
            <span className="mk-step-d">{body}</span>
          </button>
        ))}
      </div>
      <div
        className="mk-screen"
        id="tour-panel"
        role="tabpanel"
        aria-labelledby={`tour-tab-${step.id}`}
      >
        <div className="mk-win">
          <div className="mk-chrome" aria-hidden="true">
            <span />
            <span />
            <span />
            <em>thesis.rademics.ai / {step.path}</em>
          </div>
          {/* biome-ignore lint/performance/noImgElement: pre-sized WebP in public/; the standalone image runs no image optimiser. */}
          <img src={step.image} alt={step.alt} width={1600} height={935} loading="lazy" />
        </div>
      </div>
    </div>
  );
}
