/**
 * ADR-0135: a sentence about another state or country, written as if it framed the thesis.
 */

import { describe, expect, it } from 'vitest';
import {
  marksAnotherSetting,
  ownPlaces,
  placesIn,
  unmarkedOtherSettings,
} from '../src/builder/setting.js';

const KARNATAKA = 'Barriers to rooftop solar adoption among rural households in Karnataka';

describe('placesIn', () => {
  it('finds states and countries by their usual spellings', () => {
    expect([...placesIn('Rural Tamilnadu and Orissa, unlike Sri Lanka')].sort()).toEqual([
      'Odisha',
      'Sri Lanka',
      'Tamil Nadu',
    ]);
  });

  it('ignores cite markers and words that only contain a name', () => {
    expect(placesIn('Goals {{cite:S1#c2}} and Indian goatherds in Goan villages').size).toBe(0);
  });

  it('prefers the longer name ("South Korea", not "Korea")', () => {
    expect([...placesIn('Evidence from South Korea')]).toEqual(['South Korea']);
  });
});

describe('ownPlaces', () => {
  it('a state thesis owns its country; a country thesis owns its states', () => {
    expect(ownPlaces(new Set(['Karnataka'])).has('India')).toBe(true);
    expect(ownPlaces(new Set(['Karnataka'])).has('Kerala')).toBe(false);
    expect(ownPlaces(new Set(['India'])).has('Kerala')).toBe(true);
  });
});

describe('unmarkedOtherSettings', () => {
  it('counts the live 2026-10-09 opener: Kerala framing a Karnataka thesis', () => {
    const live =
      'In Kerala, abundant solar potential combined with initiatives like the SOURA subsidy program positions the state as a leader in rooftop solar photovoltaic adoption, yet barriers such as financial, informational, technical and behavioural factors continue to hinder widespread implementation among households {{cite:S2#c1}}.';
    expect(unmarkedOtherSettings(live, KARNATAKA)).toEqual(['Kerala']);
  });

  it('does not count the thesis’s own state, or its country', () => {
    expect(
      unmarkedOtherSettings(
        'More than 70% of the Indian population lives in villages, and rural Karnataka is no exception {{cite:S1#c1}}.',
        KARNATAKA,
      ),
    ).toEqual([]);
    expect(
      unmarkedOtherSettings('India targets 40 GW of rooftop solar {{cite:S1#c1}}.', KARNATAKA),
    ).toEqual([]);
  });

  it('does not count another setting marked as a comparison', () => {
    for (const s of [
      'Unlike Karnataka, Kerala pairs its subsidy with utility-led installation {{cite:S2#c1}}.',
      'In neighbouring Kerala, the SOURA programme lowered upfront cost {{cite:S2#c1}}.',
      'Similar barriers appear elsewhere, as in Kerala {{cite:S2#c1}}.',
    ]) {
      expect(unmarkedOtherSettings(s, KARNATAKA)).toEqual([]);
    }
  });

  it('does not count a study reporting its own setting', () => {
    expect(
      unmarkedOtherSettings(
        'A survey of 400 households in Kerala found that upfront cost was the main barrier {{cite:S2#c1}}.',
        KARNATAKA,
      ),
    ).toEqual([]);
  });

  it('does not count an example marked as one (the opener round, 2026-10-09)', () => {
    const KENYA = 'Mobile money and the incomes of smallholder farmers in Kenya';
    for (const s of [
      'For instance, adoption of mobile money in northern Ghana led to increased use of fertilizers {{cite:S2#c1}}.',
      'Adoption raises farm output, as evidenced by higher production in northern Ghana {{cite:S2#c1}}.',
    ]) {
      expect(unmarkedOtherSettings(s, KENYA)).toEqual([]);
    }
    expect(
      unmarkedOtherSettings(
        'In rural Ghana, adoption of mobile money among smallholder farmers positively influences the use of inputs {{cite:S2#c1}}.',
        KENYA,
      ),
    ).toEqual(['Ghana']);
  });

  it('counts a country the scope does not name', () => {
    expect(
      unmarkedOtherSettings(
        'Germany leads household solar adoption through feed-in tariffs {{cite:S3#c1}}.',
        KARNATAKA,
      ),
    ).toEqual(['Germany']);
  });

  it('counts nothing when the scope names no place', () => {
    expect(
      unmarkedOtherSettings(
        'In Kerala, the subsidy positions the state as a leader {{cite:S2#c1}}.',
        'Corrosion of maraging steel produced by selective laser melting',
      ),
    ).toEqual([]);
  });

  it('a thesis on India owns every state in it', () => {
    expect(
      unmarkedOtherSettings(
        'In Kerala, the subsidy positions the state as a leader {{cite:S2#c1}}.',
        'Why rural households delay rooftop solar adoption in India',
      ),
    ).toEqual([]);
  });
});

describe('marksAnotherSetting', () => {
  it('reads comparison and reporting wording, not a bare "In X,"', () => {
    expect(marksAnotherSetting('In Kerala, the state leads adoption.')).toBe(false);
    expect(marksAnotherSetting('Compared with Kerala, uptake is slower.')).toBe(true);
    expect(marksAnotherSetting('Studies in Kerala report high trust.')).toBe(true);
  });
});
