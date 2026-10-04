import { describe, expect, it } from 'vitest';
import {
  canReadBeside,
  clampPaneWidth,
  PANE_MIN_WIDTH,
  pdfAtPage,
  RESERVED_WIDTH,
} from '../src/lib/read-beside';

describe('Read beside', () => {
  it('opens a signed link at the cited page, replacing any fragment it had', () => {
    const signed = 'https://thesis.example/thesis-copilot/sources/a.pdf?X-Amz-Signature=abc';
    expect(pdfAtPage(signed, 7)).toBe(`${signed}#page=7`);
    expect(pdfAtPage(`${signed}#page=2`, 9)).toBe(`${signed}#page=9`);
    expect(pdfAtPage(signed, null)).toBe(signed);
    expect(pdfAtPage(signed, 0)).toBe(signed);
    expect(pdfAtPage(signed, 2.5)).toBe(signed);
  });

  it('is offered only on a screen wide enough for a second column', () => {
    expect(canReadBeside(375)).toBe(false);
    expect(canReadBeside(1024)).toBe(false);
    expect(canReadBeside(1280)).toBe(true);
    expect(canReadBeside(1920)).toBe(true);
  });

  it('keeps the pane between its minimum and what leaves the chapter room', () => {
    expect(clampPaneWidth(100, 1920)).toBe(PANE_MIN_WIDTH);
    expect(clampPaneWidth(600, 1920)).toBe(600);
    expect(clampPaneWidth(5000, 1920)).toBe(1920 - RESERVED_WIDTH);
    // On a screen with no room to spare, the minimum still holds.
    expect(clampPaneWidth(600, 1100)).toBe(PANE_MIN_WIDTH);
  });
});
