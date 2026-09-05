/**
 * A structurally valid `PaperExtraction` derived from the paper's own text, for use with the mock
 * provider when no API key is configured.
 *
 * This is NOT an extraction model. It reads the obvious structure out of the text — the first line
 * as a title, lines after an "Abstract" heading, numbered entries after a "References" heading —
 * so that with `AI_PROVIDER=mock` an upload still produces a sensible proposal screen and library
 * to develop against. It invents nothing: every field is copied from the input or left empty,
 * which is the same rule A.5 gives the real model.
 *
 * PRD §0.3 rule 5 forbids guessing at model behaviour, and this does not claim to be model output:
 * `AiCallLog` records `mock-strong` and a cost of zero, and `pnpm ai:verify` refuses to let mock
 * output stand in for a real verification.
 */

import { emptyExtraction, type PaperExtraction } from '@tc/types';

const HEADING =
  /^\s*(?:\d+\.?\s*)?(abstract|introduction|method(?:ology|s)?|results?|discussion|conclusions?|references|bibliography)\s*:?\s*$/i;
const REFERENCE_ENTRY = /^\s*(?:\[\d+\]|\(\d+\)|\d+\.)\s+\S/;
const DOI_IN_TEXT = /\b10\.\d{4,9}\/\S+/;

/** Pulls the text back out of the A.5 user message. */
export function paperTextFromMessage(content: string): string {
  const match = /<paper[^>]*>([\s\S]*)<\/paper>/.exec(content);
  return match?.[1] ?? content;
}

export function deriveExtraction(text: string): PaperExtraction {
  const lines = text.split('\n').map((l) => l.trim());
  const extraction = emptyExtraction();

  // Title: the first line with real content that is not itself a heading.
  extraction.title = lines.find((l) => l.length > 0 && !HEADING.test(l)) ?? '';

  let section: string | null = null;
  const abstractLines: string[] = [];
  const referenceLines: string[] = [];

  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading?.[1]) {
      section = heading[1].toLowerCase();
      extraction.sections.push({ heading: line, summary: '' });
      continue;
    }
    if (line.length === 0) continue;

    if (section === 'abstract') abstractLines.push(line);
    else if (section === 'references' || section === 'bibliography') {
      if (REFERENCE_ENTRY.test(line)) referenceLines.push(line);
      // A wrapped continuation belongs to the entry above it.
      else if (referenceLines.length > 0) {
        referenceLines[referenceLines.length - 1] = `${referenceLines.at(-1)} ${line}`;
      }
    } else if (section?.startsWith('method') && !extraction.methodology) {
      extraction.methodology = line;
    }
  }

  extraction.abstract = abstractLines.join(' ');
  extraction.references = referenceLines.map((raw) => {
    const doi = DOI_IN_TEXT.exec(raw)?.[0];
    return doi ? { raw, doi } : { raw };
  });

  return extraction;
}

/** A `MockResponse` that answers an EXTRACT request from the paper it was given. */
export const mockExtractionResponse = {
  match: (req: { action: string }) => req.action === 'EXTRACT',
  respond: (req: { messages: ReadonlyArray<{ content: string }> }) =>
    deriveExtraction(paperTextFromMessage(req.messages.at(-1)?.content ?? '')),
};
