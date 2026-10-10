import { describe, expect, it } from 'vitest';
import {
  applySetupUpdate,
  isUntouchedNewThesis,
  namesATopic,
  newSetupCard,
  readSetupCard,
  setupStepNumber,
} from '../src/setup-card.js';

const DAY = 24 * 60 * 60 * 1000;

describe('the setup card state (ADR-0145)', () => {
  it('reads only a well-formed card, and none from a thesis that never had one', () => {
    expect(readSetupCard(null)).toBeNull();
    expect(readSetupCard({ sourcePrefs: {} })).toBeNull();
    expect(readSetupCard({ setup: { step: 'nowhere' } })).toBeNull();
    expect(readSetupCard({ setup: newSetupCard() })).toEqual(newSetupCard());
  });

  it('changes only the parts an update gives', () => {
    const now = new Date('2026-10-09T10:00:00Z');
    const card = applySetupUpdate(newSetupCard(), { step: 'field' }, now);
    expect(card).toEqual({ ...newSetupCard(), step: 'field' });
    const later = applySetupUpdate(card, { dismissed: true }, now);
    expect(later.dismissedAt).toBe(now.toISOString());
    expect(later.step).toBe('field');
    expect(applySetupUpdate(later, { dismissed: false }).dismissedAt).toBeNull();
    expect(setupStepNumber('chapters')).toBe(3);
    // ADR-0151: a card saved on the old field row counts as the aim row, the title row's next.
    expect(setupStepNumber('field')).toBe(2);
    expect(setupStepNumber('first')).toBe(4);
  });

  it('a title names a topic with three real words, never as a placeholder', () => {
    expect(namesATopic('Untitled thesis')).toBe(false);
    expect(namesATopic('Solar dryers')).toBe(false);
    expect(namesATopic('Barriers to rooftop solar adoption')).toBe(true);
  });
});

describe('an untouched thesis from New (ADR-0145)', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  const row = {
    title: 'Untitled thesis',
    createdAt: new Date(now.getTime() - 2 * DAY),
    meta: { setup: newSetupCard() },
    chapters: [{ title: 'Chapter 1', wordCount: 2 }],
  };

  it('is left off the list after a day', () => {
    expect(isUntouchedNewThesis(row, now)).toBe(true);
  });

  it('stays while it is new, named, written in or set up further, and when it had no card', () => {
    const young = { ...row, createdAt: new Date(now.getTime() - DAY / 2) };
    expect(isUntouchedNewThesis(young, now)).toBe(false);
    expect(isUntouchedNewThesis({ ...row, title: 'Fish drying losses in Kerala' }, now)).toBe(
      false,
    );
    const written = { ...row, chapters: [{ title: 'Chapter 1', wordCount: 9 }] };
    expect(isUntouchedNewThesis(written, now)).toBe(false);
    const further = { ...row, meta: { setup: { ...newSetupCard(), step: 'field' } } };
    expect(isUntouchedNewThesis(further, now)).toBe(false);
    expect(isUntouchedNewThesis({ ...row, meta: {} }, now)).toBe(false);
  });
});
