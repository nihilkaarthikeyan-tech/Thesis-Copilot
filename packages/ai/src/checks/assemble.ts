/**
 * Assembly — spec §3 stage 6, "code only": join the sections, fix the spacing, remove duplicate
 * sentences across sections (keep the first), drop a connective that opens a section with
 * nothing before it, drop meta-narration outside the organisation section. Nothing here calls a
 * model; the counts go in the QA report as L1, L2, L7 and L8.
 */

import {
  isRoadmap,
  nearDuplicate,
  opensWithConnective,
  splitSentences,
} from '../builder/quality.js';
import { paragraphsOf, wordCount } from './text.js';

export type AssemblyCounts = {
  /** L1 */
  duplicates: number;
  /** L2 */
  spacing: number;
  /** L7 */
  dangling: number;
  /** L8 */
  roadmap: number;
};

export type AssemblySection = { id: string; markdown: string; organisation: boolean };

/**
 * A missing space after a sentence end: "…Hastelloy EDM.This synthesis…". The next character must
 * start a word (a capital followed by a lowercase letter), so "U.S.A." and initials are left alone.
 */
const MISSING_SPACE = /([\p{L}\p{N})\]”’"'])([.?!])(?=[\p{Lu}][\p{Ll}])/gu;

export function fixSpacing(text: string): { text: string; fixed: number } {
  let fixed = 0;
  const out = text
    .replace(MISSING_SPACE, (_m, a: string, p: string) => {
      fixed++;
      return `${a}${p} `;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n');
  return { text: out, fixed };
}

/**
 * Assembles the sections in order. `existing` is the chapter's current prose, so a built section
 * does not repeat what the student already wrote.
 */
export function assembleSections(
  sections: readonly AssemblySection[],
  existing = '',
): { sections: AssemblySection[]; counts: AssemblyCounts } {
  const counts: AssemblyCounts = { duplicates: 0, spacing: 0, dangling: 0, roadmap: 0 };
  const kept: string[] = splitSentences(existing).filter((s) => wordCount(s) >= 5);
  const out: AssemblySection[] = [];

  for (const section of sections) {
    const spaced = fixSpacing(section.markdown);
    counts.spacing += spaced.fixed;
    const blocks: string[] = [];
    let previousSentence: string | null = null;

    for (const paragraph of paragraphsOf(spaced.text)) {
      if (paragraph.heading || paragraph.needsSource) {
        blocks.push(paragraph.text);
        previousSentence = null;
        continue;
      }
      const sentences = splitSentences(paragraph.text);
      const keptHere: string[] = [];
      for (const sentence of sentences) {
        if (!section.organisation && isRoadmap(sentence)) {
          counts.roadmap++;
          continue;
        }
        if (opensWithConnective(sentence) && previousSentence === null && blocks.length === 0) {
          // The first sentence of a section that begins "However, …": nothing before it.
          counts.dangling++;
          continue;
        }
        if (wordCount(sentence) >= 5 && kept.some((other) => nearDuplicate(sentence, other))) {
          counts.duplicates++;
          continue;
        }
        keptHere.push(sentence);
        if (wordCount(sentence) >= 5) kept.push(sentence);
        previousSentence = sentence;
      }
      if (keptHere.length > 0) blocks.push(keptHere.join(' '));
    }
    out.push({ ...section, markdown: blocks.join('\n\n').trim() });
  }
  return { sections: out, counts };
}
