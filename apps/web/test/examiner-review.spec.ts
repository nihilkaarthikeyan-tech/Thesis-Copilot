/** The examiner review's words on the Flags tab (ADR-0056). */

import { describe, expect, it } from 'vitest';
import {
  type ExaminerReviewState,
  elapsed,
  examinerLabel,
  isReviewRunning,
  resultLine,
} from '../src/lib/examiner-review.js';

const done = (over: Partial<ExaminerReviewState>): ExaminerReviewState => ({
  status: 'DONE',
  runId: 'r',
  startedAt: '2026-10-04T10:00:00.000Z',
  finishedAt: '2026-10-04T10:01:30.000Z',
  chapterChanged: false,
  sections: 3,
  sectionsReviewed: 3,
  failedSections: [],
  issues: 0,
  blocking: 0,
  error: null,
  ...over,
});

describe('elapsed', () => {
  it('counts minutes and seconds since the start', () => {
    expect(elapsed('2026-10-04T10:00:00.000Z', Date.parse('2026-10-04T10:01:05.000Z'))).toBe(
      '1:05',
    );
    expect(elapsed(null, Date.now())).toBe('0:00');
  });
});

describe('resultLine', () => {
  it('says plainly when there is nothing', () => {
    expect(resultLine(done({}))).toBe('The examiner found nothing to flag.');
  });

  it('counts the issues and the major ones', () => {
    expect(resultLine(done({ issues: 4, blocking: 1 }))).toBe(
      'The examiner found 4 issues, 1 major — see the flags below.',
    );
  });

  it('names the sections it could not review, and an edit since', () => {
    const line = resultLine(done({ issues: 1, failedSections: ['Methods'], chapterChanged: true }));
    expect(line).toContain('1 section could not be reviewed (Methods)');
    expect(line).toContain('You have edited the chapter since.');
  });
});

describe('labels', () => {
  it('names an examiner flag by its severity, as a report would (ADR-0111)', () => {
    expect(examinerLabel('ERROR')).toBe('Examiner: major');
    expect(examinerLabel('WARN')).toBe('Examiner: minor');
  });

  it('a queued or running review is running', () => {
    expect(isReviewRunning(done({ status: 'QUEUED' }))).toBe(true);
    expect(isReviewRunning(done({ status: 'RUNNING' }))).toBe(true);
    expect(isReviewRunning(done({}))).toBe(false);
    expect(isReviewRunning(null)).toBe(false);
  });
});
