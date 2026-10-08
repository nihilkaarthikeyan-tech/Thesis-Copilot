import { describe, expect, it } from 'vitest';
import { crossrefCitedBy } from '../src/modules/sources/paper-id.service.js';

describe("Crossref's citation count in a lookup (ADR-0125)", () => {
  it('is passed on only when it is a count, never defaulted to 0', () => {
    expect(crossrefCitedBy(54)).toBe(54);
    expect(crossrefCitedBy(0)).toBe(0);
    expect(crossrefCitedBy(undefined)).toBeNull();
    expect(crossrefCitedBy(null)).toBeNull();
    expect(crossrefCitedBy('54')).toBeNull();
    expect(crossrefCitedBy(-1)).toBeNull();
    expect(crossrefCitedBy(2.5)).toBeNull();
  });
});
