import { describe, expect, it } from 'vitest';
import { pubmedName } from '../src/modules/sources/paper-id.service.js';

describe("PubMed's names (Jenni build plan R16)", () => {
  it('are "Surname Initials", or a group', () => {
    expect(pubmedName('Bitencourt-Ferreira G')).toEqual({
      family: 'Bitencourt-Ferreira',
      given: 'G',
    });
    expect(pubmedName('de Azevedo WF')).toEqual({ family: 'de Azevedo', given: 'WF' });
    expect(pubmedName('WHO Collaborative Group')).toEqual({ literal: 'WHO Collaborative Group' });
  });
});
