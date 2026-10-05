/**
 * Whether a working title names something an index can search for, or a plan can be made from
 * (ADR-0070, ADR-0072). The placeholder titles a student leaves in, and anything of a word or
 * two, do not.
 */
export function namesATopic(title: string): boolean {
  const t = title.trim();
  if (/^(untitled|new|my)\s+(thesis|dissertation|document)$/i.test(t)) return false;
  return t.split(/\s+/).filter((w) => w.length > 2).length >= 3;
}
