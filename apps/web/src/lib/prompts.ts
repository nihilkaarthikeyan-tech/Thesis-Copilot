/**
 * The text side of saved prompts (ADR-0019), kept apart from the component so it can be tested
 * without a DOM. See `components/editor/ChatPrompts.tsx` for the feature.
 */

export type SavedPrompt = { id: string; title: string; body: string; updatedAt: string };

/**
 * The `/query` being typed, if the box is asking for a saved prompt: a `/` at the very start, on
 * one line. `''` right after the bare `/`, so the picker opens on the whole list. A `/` anywhere
 * else is just a slash — "and/or" must not open anything.
 */
export function promptQuery(text: string): string | null {
  const match = /^\/([^\n]*)$/.exec(text);
  return match ? (match[1] ?? '') : null;
}

/** A name to start from when saving: the question's first few words. */
export function suggestPromptTitle(body: string, maxWords = 6, maxChars = 60): string {
  const words = body.trim().split(/\s+/).filter(Boolean).slice(0, maxWords);
  let title = words.join(' ');
  if (title.length > maxChars) title = title.slice(0, maxChars).trimEnd();
  return title.replace(/[\s.,;:!?…]+$/u, '');
}

/**
 * The prompts that match what follows the `/`, names first: a student types the name they gave
 * it, and a match in the name is the better guess than one somewhere in the text.
 */
export function matchPrompts(prompts: readonly SavedPrompt[], query: string): SavedPrompt[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...prompts];
  const byTitle = prompts.filter((p) => p.title.toLowerCase().includes(needle));
  const byBody = prompts.filter(
    (p) => !byTitle.includes(p) && p.body.toLowerCase().includes(needle),
  );
  return [...byTitle, ...byBody];
}
