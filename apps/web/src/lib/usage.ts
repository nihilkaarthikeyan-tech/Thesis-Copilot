/** The colour of an allowance's bar as it fills (R12, ADR-0099): plenty, getting low, used up. */
export function barTone(used: number, cap: number): 'ok' | 'low' | 'out' {
  if (cap <= 0 || used >= cap) return 'out';
  return used / cap >= 0.75 ? 'low' : 'ok';
}
