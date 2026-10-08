import { describe, expect, it } from 'vitest';
import { activeMention } from '../src/lib/cite-mention';

describe('the @ citation picker’s trigger', () => {
  it('opens after a space, a bracket or the start of the line', () => {
    expect(activeMention('Cost is a barrier @rao')).toBe('rao');
    expect(activeMention('(@rao')).toBe('rao');
    expect(activeMention('@')).toBe('');
  });

  it('stays shut inside an email address', () => {
    expect(activeMention('write to priya@example')).toBeNull();
  });

  it('opens right after a citation, so the new one joins its bracket (ADR-0117)', () => {
    expect(activeMention('Cost is a barrier {{cite:c_Ab12Cd34Ef}}@rao')).toBe('rao');
    // A word that merely ends in a brace is not a citation.
    expect(activeMention('set}@rao')).toBeNull();
  });
});
