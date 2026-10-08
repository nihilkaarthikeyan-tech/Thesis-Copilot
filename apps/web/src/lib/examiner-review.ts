/**
 * The examiner review in the student's words (ADR-0056): the state the API reports, how long it
 * has been running, the finished result in one line, and the label an examiner flag carries.
 */

export type ExaminerReviewState = {
  status: 'NONE' | 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  runId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** The chapter was saved after the review read it. */
  chapterChanged: boolean;
  sections: number | null;
  sectionsReviewed: number | null;
  failedSections: string[];
  issues: number | null;
  blocking: number | null;
  error: string | null;
};

export const isReviewRunning = (s: ExaminerReviewState | null): boolean =>
  s?.status === 'QUEUED' || s?.status === 'RUNNING';

/** "1:05" — minutes and seconds since the review started. */
export function elapsed(startedAt: string | null, now: number): string {
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  const seconds = Number.isNaN(started) ? 0 : Math.max(0, Math.floor((now - started) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The finished review in one line. */
export function resultLine(s: ExaminerReviewState): string {
  const issues = s.issues ?? 0;
  const found =
    issues === 0
      ? 'The examiner found nothing to flag.'
      : `The examiner found ${issues} issue${issues === 1 ? '' : 's'}${
          s.blocking ? `, ${s.blocking} major` : ''
        } — see the flags below.`;
  const n = s.failedSections.length;
  const failed = n
    ? ` ${n} section${n === 1 ? '' : 's'} could not be reviewed (${s.failedSections.join(', ')}); running the review again retries ${n === 1 ? 'it' : 'them'}, as one more review.`
    : '';
  const changed = s.chapterChanged ? ' You have edited the chapter since.' : '';
  return `${found}${failed}${changed}`;
}

/**
 * An examiner flag's heading: its severity in words. Major and Minor since R24 (ADR-0111), the
 * words an examiner's report uses and Jenni's peer review shows; they were "blocking" and
 * "warning", the prompt's own terms.
 */
export const examinerLabel = (severity: string): string =>
  severity === 'ERROR' ? 'Examiner: major' : 'Examiner: minor';
