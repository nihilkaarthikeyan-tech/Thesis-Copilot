/**
 * Truncated-JSON repair — ADR-0048.
 *
 * When a structured answer runs out of output tokens the JSON stops mid-way, and before this the
 * whole call failed: every theme, every proofreading correction, every examiner issue the model
 * *had* finished was thrown away with the one it had not. Rademics Copilot repairs such output by
 * closing the open strings and brackets. Closing an open string would keep a value the model never
 * finished — a theme called "Cost barr", a sentence cut at "the results show" — so this does the
 * other half only: it cuts back to the last value the model completed and closes the brackets
 * around it. What survives is exactly what the model wrote; what it did not finish is gone.
 *
 * The result still goes through the schema like any other answer. An array that must not be
 * partial is the schema's to refuse; a field that becomes missing is caught the same way.
 */

/** Leading prose or a Markdown fence before the JSON, which some models add in JSON mode. */
function jsonStart(text: string): number {
  const fenced = /```(?:json)?\s*/i.exec(text);
  const from = fenced ? fenced.index + fenced[0].length : 0;
  const brace = text.indexOf('{', from);
  const bracket = text.indexOf('[', from);
  if (brace === -1) return bracket;
  if (bracket === -1) return brace;
  return Math.min(brace, bracket);
}

type Scan = {
  /** Positions just after a complete value inside a container: a safe place to cut. */
  boundaries: number[];
  /** Brackets still open at the end of the text, outermost first. */
  open: string[];
  /** The text ended inside a string. */
  inString: boolean;
  /** The JSON closed completely before the text ended; this is where. */
  completeAt: number | null;
};

function scan(text: string): Scan {
  const open: string[] = [];
  const boundaries: number[] = [];
  let inString = false;
  let escaped = false;
  let completeAt: number | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') open.push(c);
    else if (c === '}' || c === ']') {
      open.pop();
      if (open.length === 0) {
        completeAt = i + 1;
        break;
      }
      boundaries.push(i + 1);
    } else if (c === ',') boundaries.push(i);
  }
  return { boundaries, open, inString, completeAt };
}

const CLOSER: Record<string, string> = { '{': '}', '[': ']' };

/** Closes whatever is open at the end of `prefix`; null when the prefix cannot be closed. */
function closeAt(prefix: string): string | null {
  const s = scan(prefix);
  if (s.inString) return null;
  // A key with its colon but no value yet ends an object mid-pair: not a safe cut.
  if (/[:]\s*$/.test(prefix)) return null;
  const trimmed = prefix.replace(/[\s,]+$/, '');
  return (
    trimmed +
    [...s.open]
      .reverse()
      .map((b) => CLOSER[b])
      .join('')
  );
}

/**
 * The repaired JSON text, or null when there is nothing to repair or nothing complete to keep.
 * Text that already parses comes back unchanged only when a fence or prose had to be removed;
 * otherwise null, since there was nothing to repair.
 */
export function repairTruncatedJson(text: string): string | null {
  const start = jsonStart(text);
  if (start === -1) return null;
  const body = text.slice(start);

  const whole = scan(body);
  if (whole.completeAt !== null) {
    const candidate = body.slice(0, whole.completeAt);
    if (candidate === text) return null;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      return null;
    }
  }

  // Truncated: cut back boundary by boundary until what remains closes into valid JSON.
  const cuts = [...whole.boundaries].reverse().slice(0, 64);
  for (const at of cuts) {
    const closed = closeAt(body.slice(0, at));
    if (closed === null) continue;
    try {
      JSON.parse(closed);
      return closed;
    } catch {
      // try the boundary before
    }
  }
  return null;
}

/**
 * The AI SDK's `repairText` hook. Called only when the model's text failed to parse; a
 * well-formed answer that fails the schema is the schema's business, not repair's.
 */
export function makeRepairText(onRepair?: (before: number, after: number) => void) {
  return async ({ text, error }: { text: string; error: { name?: string } }) => {
    if (error?.name !== 'AI_JSONParseError') return null;
    const repaired = repairTruncatedJson(text);
    if (repaired !== null) onRepair?.(text.length, repaired.length);
    return repaired;
  };
}
