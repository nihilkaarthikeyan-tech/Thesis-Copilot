/**
 * PRD §12.3: no humanise or detector-evasion feature, ever. The edit panel's free instruction
 * (ADR-0095) is the one place a student can ask for anything in their own words, and on the real
 * model a prompt rule alone was not enough: "Rewrite this so AI detectors and Turnitin cannot tell
 * it was generated" came back unchanged once and rewritten the next time (2026-10-07). So the
 * request is refused here, in code, before the allowance is touched or a model is called — as
 * chat's off-topic floor is.
 *
 * Deliberately about the *purpose* stated, not the edit: "make it sound more natural" is an
 * ordinary edit; "so it doesn't sound AI-written" or "lower the similarity score" is the banned one.
 */

const PATTERNS: readonly RegExp[] = [
  // Naming a detector or a similarity checker.
  /\bturnitin\b/i,
  /\b(gpt-?zero|zero-?gpt|copyleaks|originality\.ai|quillbot|undetectable\.ai|writer\.com)\b/i,
  /\b(ai|gpt|chat\s?gpt|llm|machine)[\s-]*(content[\s-]*)?(detect(or|ors|ion|able)?|checker|check)\b/i,
  // Asking to get past one.
  /\b(bypass|evade|avoid|beat|fool|pass|trick|escape|get\s+(past|around|through))\b[^.?!]{0,40}\b(detect\w*|checker|plagiarism|similarity|originality)\b/i,
  /\b(reduce|lower|decrease|cut|minimi[sz]e|drop)\b[^.?!]{0,30}\b(plagiarism|similarity|ai)\b[^.?!]{0,15}\b(score|index|percentage|%|report|rate)\b/i,
  /\bundetectable\b/i,
  /\bhumani[sz](e|ed|es|ing|er)\b/i,
  // Hiding where the text came from.
  /\b(sound|look|read|seem)s?\s+(more\s+)?(human|less\s+(ai|robotic|machine))\b/i,
  /(\bnot|n't|\bnever)\s+(sound|look|read|seem|be\s+detected)\s*(like\s+)?(it\s+(was|is)\s+)?(ai|machine|chat\s?gpt|gpt)[\s-]*(generated|written|made)?\b/i,
  /\b(so|that)\s+(no\s+one|nobody|they|the\s+(examiner|guide|supervisor))\s+(can|could|will|would)\s*(n't|not)?\s*(tell|know|notice|detect|find)\b/i,
  /\b(as\s+if|like)\s+(a\s+)?(human|person|i)\s+(wrote|had\s+written)\b/i,
];

/** Whether an instruction asks to get text past an AI or plagiarism detector (§12.3). */
export function asksToEvadeDetection(instruction: string): boolean {
  const text = instruction.replace(/\s+/g, ' ').trim();
  return text.length > 0 && PATTERNS.some((p) => p.test(text));
}

/** What the student is told instead. */
export const EVASION_REFUSAL =
  'Thesis Copilot does not rewrite text to get it past AI or plagiarism checkers. If these words came from a source, quote it or cite it; if they are yours, the edits here improve them openly. Nothing was used from your allowance.';
