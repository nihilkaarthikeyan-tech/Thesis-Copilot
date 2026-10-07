import { describe, expect, it } from 'vitest';
import { asksToEvadeDetection } from '../src/builder/evasion.js';

describe('a request to get past a detector is refused in code (§12.3, ADR-0095)', () => {
  it.each([
    'Rewrite this so AI detectors and Turnitin cannot tell it was generated.',
    'make it undetectable',
    'Humanize this paragraph',
    'humanise it please',
    'Lower the plagiarism score of this',
    'reduce the similarity percentage',
    'bypass GPTZero',
    'so it does not sound AI generated',
    "make sure it doesn't look like ChatGPT wrote it",
    'Make it sound more human',
    'so that the examiner cannot tell',
    'rewrite as if a human wrote it',
    'pass the AI checker',
    'avoid plagiarism detection',
  ])('refuses: %s', (instruction) => {
    expect(asksToEvadeDetection(instruction)).toBe(true);
  });

  it.each([
    'Make this sound more natural and less repetitive.',
    'Use "households" consistently and cut it to one sentence per claim.',
    'Make this sound more like a methods chapter.',
    'Add a sentence on how plagiarism was avoided in the survey design.',
    'Explain the similarity between the two models more clearly.',
    'Make the detection limits of the instrument clearer.',
    'Shorter, and in the passive voice.',
    'Translate the second sentence into Hindi.',
  ])('allows: %s', (instruction) => {
    expect(asksToEvadeDetection(instruction)).toBe(false);
  });
});
