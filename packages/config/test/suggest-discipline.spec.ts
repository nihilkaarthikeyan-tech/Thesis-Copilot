/**
 * The build screen suggests a discipline before the student has chosen one (ADR-0039). It once
 * suggested "Engineering (core)" — the fallback — for a mangrove soil-carbon thesis, because the
 * thesis had no field and the title was never read.
 */

import { describe, expect, it } from 'vitest';
import { suggestDiscipline } from '../src/profiles/index.js';

const id = (field: string | null, title?: string | null) =>
  suggestDiscipline(field, title)?.id ?? null;

describe('suggestDiscipline', () => {
  it('reads an environmental-science title when there is no field', () => {
    expect(
      id(
        null,
        'Soil organic carbon recovery in restored versus natural mangrove stands in Pichavaram, Tamil Nadu',
      ),
    ).toBe('agriculture_environment_v1');
  });

  it('does not take "Tamil Nadu" for a thesis about the Tamil language', () => {
    expect(id(null, 'Groundwater quality in coastal aquifers of Tamil Nadu')).toBe(
      'agriculture_environment_v1',
    );
  });

  it('reads a nursing title', () => {
    expect(
      id(null, 'Effect of a nurse-led intervention on glycaemic control in patients with diabetes'),
    ).toBe('medicine_health_v1');
  });

  it('reads a law title', () => {
    expect(
      id(null, 'Constitutional validity of preventive detention laws in India: a doctrinal study'),
    ).toBe('law_v1');
  });

  it('lets the field outweigh the title', () => {
    expect(id('Mechanical Engineering', 'Wear of AA7050 composites in a marine environment')).toBe(
      'engineering_core_v1',
    );
    expect(id('Commerce', 'Investor sentiment and stock returns')).toBe('management_commerce_v1');
    expect(id('Environmental Science', null)).toBe('agriculture_environment_v1');
  });

  it('matches the start of a department name in the field', () => {
    expect(id('Mech', null)).toBe('engineering_core_v1');
  });

  it('asks rather than guesses when nothing matches', () => {
    expect(id(null, 'A study of the things')).toBeNull();
    expect(id(null, null)).toBeNull();
    expect(id('', '')).toBeNull();
  });
});
