/**
 * Passwords on the web side — ADR-0033.
 *
 * The rule is length, and only length (NIST 800-63B; the API enforces the same two numbers). The
 * two functions below turn Better Auth's error codes into sentences a student can act on; the
 * codes are the library's contract, the wording is ours.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Null when the password is acceptable; otherwise the sentence to show. */
export function passwordProblem(password: string, repeat?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters. A short sentence you will remember is ideal.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (repeat !== undefined && repeat !== password) return 'The two passwords do not match.';
  return null;
}

/** A refused password sign-in, explained. */
export function passwordSignInProblem(code: string | undefined, fallback?: string): string {
  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return (
        'That email and password do not match. If you have never set a password on this ' +
        'account, email yourself a code instead — or use “Forgot your password?” to make one.'
      );
    case 'EMAIL_NOT_VERIFIED':
      return (
        'Confirm your email first. We have just sent the link again — open it and you will be ' +
        'signed in.'
      );
    default:
      return fallback ?? 'Could not sign you in. Try again.';
  }
}

/** A refused reset, explained. */
export function resetProblem(code: string | undefined, fallback?: string): string {
  switch (code) {
    case 'INVALID_TOKEN':
      return 'This link has expired or was already used. Ask for a new one below.';
    case 'PASSWORD_TOO_SHORT':
      return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
    case 'PASSWORD_TOO_LONG':
      return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
    default:
      return fallback ?? 'Could not set that password. Try again.';
  }
}
