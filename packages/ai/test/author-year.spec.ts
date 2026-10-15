/**
 * ADR-0155 item 3 (the Word test, 2026-10-16): suggestions wrote the passage tag into the prose,
 * "The study by Bagla 2026 highlights…", "Findings from Kodali 2026 indicate…". Rewritten in code
 * with a closed pattern; the citation marker is never added, removed or moved.
 */

import { describe, expect, it } from 'vitest';
import { rewriteBareAuthorYear } from '../src/builder/author-year.js';
import { postProcessDraft } from '../src/builder/draft.js';
import { postProcessAssist } from '../src/builder/postprocess.js';

const PASSAGES = [
  { id: 'S1#c1', shortRef: 'Bagla 2026' },
  { id: 'S1#c2', shortRef: 'Bagla 2026' },
  { id: 'S2#c1', shortRef: 'Sahu 2022' },
  { id: 'S3#c1', shortRef: 'Kodali 2026' },
  { id: 'S4#c1', shortRef: 'Power on the Roof: Reviewing Rooftop Solar 2025' },
];
const markers = (t: string) => [...t.matchAll(/\{\{cite:[^}]+\}\}/g)].map((m) => m[0]);
const rewrite = (t: string, before = '') => rewriteBareAuthorYear(t, PASSAGES, before).text;

describe('an author and year written bare into the prose (ADR-0155)', () => {
  it('the sentences from the Word file', () => {
    expect(
      rewrite(
        'The study by Bagla 2026 highlights that the key obstacles lie in the disconnect between policy and household realities. This approach focuses on the last mile {{cite:S1#c1}}.',
      ),
    ).toBe(
      'One study highlights that the key obstacles lie in the disconnect between policy and household realities. This approach focuses on the last mile {{cite:S1#c1}}.',
    );
    expect(
      rewrite(
        'Findings from Kodali 2026 indicate that willingness is high but awareness is low {{cite:S3#c1}}.',
      ),
    ).toBe(
      'Findings from one study indicate that willingness is high but awareness is low {{cite:S3#c1}}.',
    );
  });

  it('"this study" when the paper was cited before, in the text or before the cursor', () => {
    expect(
      rewrite(
        'Policy drives intention {{cite:S2#c1}}. The study by Sahu 2022 found no effect of risk {{cite:S2#c1}}.',
      ),
    ).toBe(
      'Policy drives intention {{cite:S2#c1}}. This study found no effect of risk {{cite:S2#c1}}.',
    );
    expect(
      rewrite(
        'However, the study by Sahu 2022 also notes that risk had no effect {{cite:S2#c1}}.',
        'Behavioural intention is driven by policy (Sahu et al., 2022).',
      ),
    ).toBe('However, this study also notes that risk had no effect {{cite:S2#c1}}.');
  });

  it('keeps the lead-in noun, and reads "research" and "work" as a study', () => {
    expect(rewrite('A review by Bagla 2026 maps the barriers {{cite:S1#c2}}.')).toBe(
      'One review maps the barriers {{cite:S1#c2}}.',
    );
    expect(rewrite('Research by Sahu et al. 2022 shows it {{cite:S2#c1}}.')).toBe(
      'One study shows it {{cite:S2#c1}}.',
    );
    expect(rewrite('As Kodali 2026 shows, awareness is low {{cite:S3#c1}}.')).toBe(
      'As one study shows, awareness is low {{cite:S3#c1}}.',
    );
  });

  it('leaves it when that paper is not cited in the text: the name is the only attribution', () => {
    const text = 'The study by Bagla 2026 highlights the gap {{cite:S2#c1}}.';
    expect(rewrite(text)).toBe(text);
  });

  it('leaves a bracketed year, a different year, another name and a title tag alone', () => {
    for (const text of [
      'Bagla (2026) highlights the gap {{cite:S1#c1}}.',
      'The study by Bagla 2019 highlights the gap {{cite:S1#c1}}.',
      'The study by Baglaa 2026 highlights the gap {{cite:S1#c1}}.',
      'In 2026 Bagla wrote about the gap {{cite:S1#c1}}.',
      'Power on the Roof 2025 lists them {{cite:S4#c1}}.',
    ]) {
      expect(rewrite(text)).toBe(text);
    }
  });

  it('never adds, removes or moves a marker', () => {
    const text =
      'The study by Bagla 2026 highlights the gap. Findings from Kodali 2026 agree {{cite:S3#c1}}{{cite:S1#c1}}.';
    expect(markers(rewrite(text))).toEqual(markers(text));
  });

  it('runs in a suggestion and in a draft', () => {
    const assist = postProcessAssist({
      output:
        'The study by Sahu 2022 found that policy drives intention. Awareness also shapes decisions {{cite:S2#c1}}.',
      passageIds: PASSAGES.map((p) => p.id),
      passages: PASSAGES,
      before: 'Adoption remains low.',
    });
    expect(assist.text).toBe(
      'One study found that policy drives intention. Awareness also shapes decisions {{cite:S2#c1}}.',
    );
    expect(assist.cited).toEqual(['S2#c1']);

    const draft = postProcessDraft(
      'Findings from Kodali 2026 indicate that awareness is low among rural households in the state {{cite:S3#c1}}.',
      PASSAGES.map((p) => ({ ...p, page: null, text: 'A passage.' })),
      10,
    );
    expect(draft.result.markdown).toBe(
      'Findings from one study indicate that awareness is low among rural households in the state {{cite:S3#c1}}.',
    );
  });
});
