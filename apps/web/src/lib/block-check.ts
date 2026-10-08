/**
 * A check on one paragraph (Jenni build plan R26, ADR-0126). The block menu (or the selection
 * toolbar, for the examiner) asks the Check tab to run one of its checks on a range of the
 * chapter; the panel that owns the check runs it, keeps the results in its own list, and opens
 * them in the text through review mode (ADR-0110), as a whole-chapter run does.
 *
 * Every check here takes a unit from the allowance, so a request is run once only: a panel that
 * mounts again later (the student switched tabs and came back), or React running an effect twice
 * in development, must not spend a second unit on the same press. `takeBlockCheck` says yes the
 * first time a request is seen and no ever after.
 */

/** The checks that can read one paragraph: proofreading, the tone review, the examiner. */
export type BlockCheck = 'proofread' | 'tone' | 'examiner';

export type BlockCheckRequest = {
  check: BlockCheck;
  /** Positions in the chapter as saved (the panel saves first): the block's start and end. */
  from: number;
  to: number;
  /** The student's word for what is read: a block from the handle, or text they selected. */
  scope: 'paragraph' | 'selection';
  /** A new press is a new request, even on the same paragraph. */
  nonce: number;
};

const taken = new Set<number>();

/** True the first time `request` is seen by a panel that runs `check`; false ever after. */
export function takeBlockCheck(
  request: BlockCheckRequest | null | undefined,
  check: BlockCheck,
): request is BlockCheckRequest {
  if (!request || request.check !== check || taken.has(request.nonce)) return false;
  taken.add(request.nonce);
  return true;
}

let last = 0;

/** A request for `check` on `from`–`to`, with a nonce no earlier request has had. */
export function blockCheckRequest(
  check: BlockCheck,
  from: number,
  to: number,
  scope: BlockCheckRequest['scope'] = 'paragraph',
): BlockCheckRequest {
  // Date.now() alone repeats when two presses land in the same millisecond.
  last = Math.max(last + 1, Date.now());
  return { check, from, to, scope, nonce: last };
}
