/**
 * A style, shown before it is chosen (2026-10-04, from the Jenni study: Jenni previews a style
 * as the student picks it).
 *
 * One in-text citation and one bibliography entry, rendered by the same citeproc pass a thesis
 * uses (`renderCitations`), from one fixed reference. The reference is invented on purpose and
 * says so — its title and journal name themselves as an example — so a preview can never be
 * mistaken for, or copied as, a real paper. No identifier (DOI, URL) is given: a made-up DOI would
 * look real in the output.
 */

import type { SourceLike } from './csl.js';
import { renderCitations } from './render.js';
import type { StyleFamily } from './styles.js';

/** The fixed example reference. Not a real paper; the UI labels it so as well. */
export const SAMPLE_REFERENCE: SourceLike = {
  id: 'example-reference',
  cslJson: {
    type: 'article-journal',
    title: 'An example article title, used only to preview this style',
    author: [
      { family: 'Example', given: 'Anita' },
      { family: 'Sample', given: 'Ravi' },
    ],
    issued: { 'date-parts': [[2024]] },
    'container-title': 'Journal of Example Studies',
    volume: '12',
    issue: '3',
    page: '45-67',
  },
};

/** What the student is told the sample is, wherever a preview is shown. */
export const SAMPLE_LABEL = 'Example reference, not a real paper';

export type StylePreview = {
  styleId: string;
  label: string;
  family: StyleFamily;
  /** True for a footnote style: `inText` is then the text of the note, not a bracketed label. */
  noteStyle: boolean;
  /** How the sample is cited in the running text (or in its footnote). */
  inText: string;
  /** The sample as the bibliography prints it. */
  bibliography: string;
  sampleLabel: string;
  /** The CSL locale the preview was rendered in (ADR-0058). */
  locale: string;
};

/**
 * The preview for one style. The caller has already made the style renderable (the API's
 * `StyleStoreService.ensure` for a catalogue style); an unknown id renders the default style,
 * exactly as `renderCitations` does, so callers should check the id first. `locale` is the one
 * the student's thesis renders in, so the preview shows the "and" or "&" they will get.
 */
export function previewStyle(
  styleId: string,
  stylesDir?: string,
  locale?: string | null,
): StylePreview {
  const result = renderCitations(
    {
      style: styleId,
      locale,
      sources: [SAMPLE_REFERENCE],
      citations: [{ key: 'example', sourceId: SAMPLE_REFERENCE.id }],
    },
    stylesDir,
  );
  return {
    styleId: result.style.id,
    label: result.style.label,
    family: result.style.family,
    noteStyle: result.noteStyle,
    inText: result.labels.example ?? '',
    bibliography: result.bibliography[0]?.text ?? '',
    sampleLabel: SAMPLE_LABEL,
    locale: result.locale,
  };
}
