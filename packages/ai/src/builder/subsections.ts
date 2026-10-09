/**
 * Sub-sections in code — ADR-0138 (R5b).
 *
 * Jenni's "Smart headings" put sub-headings under the sections a thesis divides: a Methodology
 * section into its procedures, a review theme into its strands ("Adoption barriers" → economic,
 * institutional, technical). Four prompt candidates for A.9 tried to make the model write them
 * (ADR-0092 addenda 3 and 4); each either cost the title-only plan its Literature Review or left
 * some plans with none. So A.9 is unchanged and the sub-sections are added here, after the call,
 * from words the plan already has:
 *
 * 1. A Literature Review or Methodology section whose title names several parts joined by "and"
 *    or commas is given one sub-section per part: "Financing, incentives and affordability" →
 *    Financing / Incentives / Affordability; "Technical and infrastructural constraints" →
 *    Technical constraints / Infrastructural constraints. Nothing is invented: every word of a
 *    sub-section title is in its parent's title.
 * 2. A section called just "Methodology" (or "Methods"), wherever it sits, is given the parts every
 *    Methodology blueprint has (ADR-0039): design, data collection, analysis — the blueprint's
 *    own titles.
 *
 * A section the model already divided keeps its children; a gap, summary or overview section and
 * a title whose "and" sits inside a phrase ("relationship between X and Y", "effects of X on Y and
 * Z", "research and development") are left whole. Results, Discussion and the rest are never
 * touched (ADR-0092 addendum 4, criterion 2).
 */

import { blueprintFor, chapterRoleFor, type Template } from '@tc/config';
import type { OutlineNode } from '@tc/types';

/** The most sub-sections one section is split into; a longer list is a sentence, not headings. */
const MAX_PARTS = 4;
/** The longest part, in words, that still reads as a heading. */
const MAX_PART_WORDS = 6;
/**
 * The most sections one chapter has divided: those naming the most parts, then the earliest.
 * Measured on the ten title-only and gap-map plans of the outline rounds, splitting every "X and
 * Y" gave a Methodology up to six divided sections (23 sub-headings in one plan) — a chapter of
 * headings. Jenni divides a few.
 */
const MAX_DIVIDED_PER_CHAPTER = 3;

/** Sections that sum up or frame the others are not divided. */
const WHOLE_SECTION =
  /\b(gap|gaps|summary|synthesis|overview|introduction|conclusions?|chapter outline|organisation|organization)\b/i;
/** A comparison or a relation: its "and" joins the two sides of one thing. */
const RELATION = /\b(between|versus|vs\.?|among|amongst|or)\b/i;
/** "Effects of X on Y and Z": an "and" after a preposition sits inside the phrase. */
const PREPOSITION =
  /\b(of|on|in|for|to|with|from|by|under|within|across|through|into|towards?|at)\b/i;
/** Pairs that are one thing. */
const FIXED_PAIRS = [
  'research and development',
  'monitoring and evaluation',
  'supply and demand',
  'trial and error',
  'pros and cons',
  'rules and regulations',
  'terms and conditions',
  'health and safety',
  'reliability and validity',
  'validity and reliability',
  'strengths and weaknesses',
  'cause and effect',
  'design and build',
];
/** A part that is a reason for the section, not a part of its work: "design and rationale". */
const WEAK_PART =
  /^(rationale|justification|significance|scope|overview|context|background|approach|strategy|plan|purpose|aims?|motivation|delimitations?|definitions?|introduction)$/i;
/** Looks like an adjective: Economic, Institutional, Behavioural, Solar, Regulatory… */
const ADJECTIVE = /^[a-z][a-z-]*(al|ic|ive|ous|ary|ory|ible|able|ful|less|ar|ian)$/i;
/** Plural kind-nouns that one modifier word can share: "Policy and institutional barriers". */
const KIND_NOUN =
  /^(barriers|factors|determinants|constraints|drivers|influences|effects|outcomes|impacts|challenges|dimensions|aspects|considerations|issues|risks|benefits|properties|mechanisms|policies|perspectives|approaches|methods|models|theories|frameworks|dimensions|costs|incentives|enablers|motivations)$/i;

const words = (s: string) => s.split(/\s+/).filter(Boolean);
const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * The parts a section title names, or null when it should stay one section. Exported for tests.
 */
export function splitSectionTitle(title: string): string[] | null {
  let text = title.replace(/\s*\([^)]*\)/g, '').trim();
  if (!text || WHOLE_SECTION.test(text) || RELATION.test(text)) return null;
  const lower = text.toLowerCase();
  if (FIXED_PAIRS.some((pair) => lower.includes(pair))) return null;
  // "Adoption barriers: economic, institutional and technical" → the list after the colon.
  const colon = text.lastIndexOf(':');
  if (colon >= 0) text = text.slice(colon + 1).trim();
  text = text.replace(/\s*&\s*/g, ' and ');
  if (!/\sand\s/i.test(text)) return null;

  const parts = text
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
    .map((p) => p.trim().replace(/^the\s+/i, ''))
    .filter(Boolean);
  if (parts.length < 2 || parts.length > MAX_PARTS) return null;
  const leading = parts.slice(0, -1);
  const last = parts.at(-1) as string;
  if (leading.some((p) => PREPOSITION.test(p))) return null;
  if (parts.some((p) => WEAK_PART.test(p) || words(p).length > MAX_PART_WORDS)) return null;

  // "Technical and infrastructural constraints": the leading words modify the last part's noun.
  const lastWords = words(last);
  const head = lastWords.slice(1).join(' ');
  const singleWords = leading.every((p) => words(p).length === 1);
  const distribute =
    lastWords.length >= 2 &&
    singleWords &&
    (leading.every((p) => ADJECTIVE.test(p)) ||
      (ADJECTIVE.test(lastWords[0] as string) && KIND_NOUN.test(lastWords[1] as string)));
  const titles = distribute ? [...leading.map((p) => `${p} ${head}`), last] : parts;

  const out = titles.map((t) => capitalise(t));
  const unique = new Set(out.map((t) => t.toLowerCase()));
  return unique.size === out.length ? out : null;
}

/** The sentences of the parent's note that speak about this part, as the sub-section's note. */
function noteFor(part: string, parentNote: string): string {
  const stems = words(part.toLowerCase())
    .map((w) => w.replace(/[^a-z-]/g, ''))
    .filter((w) => w.length >= 4)
    .map((w) => w.slice(0, 5));
  if (stems.length === 0) return '';
  const sentences = parentNote.match(/[^.!?]+[.!?]+/g) ?? [];
  const hits = sentences.filter((s) => {
    const lower = s.toLowerCase();
    return stems.some((stem) => new RegExp(`\\b${stem.replace(/-/g, '\\-')}`).test(lower));
  });
  return hits
    .slice(0, 2)
    .map((s) => s.trim())
    .join(' ');
}

const METHOD_SECTION = /^(research\s+)?(methodology|methods?)$/i;
/** ADR-0039's Methodology parts that every paradigm has some version of. */
const METHOD_PARTS = ['method.design', 'method.collection', 'method.analysis'];

function methodParts(): string[] {
  const elements = blueprintFor('METHOD')?.elements ?? [];
  return METHOD_PARTS.map((key) => elements.find((e) => e.key === key)?.title).filter(
    (t): t is string => Boolean(t),
  );
}

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'part';

function withChildren(
  section: OutlineNode,
  titles: readonly string[],
  used: Set<string>,
): OutlineNode {
  const children = titles.map((title, i) => {
    let id = `${section.id}-sub${i + 1}-${slug(title)}`;
    for (let n = 2; used.has(id); n++) id = `${section.id}-sub${i + 1}-${slug(title)}-${n}`;
    used.add(id);
    return { id, title, scopeNote: noteFor(title, section.scopeNote), children: [] };
  });
  return { ...section, children };
}

/**
 * ADR-0138: sub-sections where a thesis expects them, from the plan's own titles. Chapters and
 * any section that already has children pass through unchanged.
 */
export function addSubsections(nodes: readonly OutlineNode[], template?: Template): OutlineNode[] {
  const used = new Set<string>();
  const collect = (list: readonly OutlineNode[]) => {
    for (const n of list) {
      used.add(n.id);
      collect(n.children);
    }
  };
  collect(nodes);
  const parts = methodParts();

  return nodes.map((chapter, order) => {
    const role = chapterRoleFor(
      { title: chapter.title, order, outlineNodeId: chapter.id },
      nodes,
      template ?? null,
    );
    const divisible = role === 'LITERATURE' || role === 'METHOD';
    const splits = chapter.children.map((section) => {
      if (section.children.length > 0) return null;
      if (METHOD_SECTION.test(section.title.trim()) && parts.length > 0) return parts;
      return divisible ? splitSectionTitle(section.title) : null;
    });
    // The sections naming the most parts, then the earliest, up to the chapter's limit.
    const chosen = new Set(
      splits
        .map((split, i) => ({ i, n: split?.length ?? 0 }))
        .filter((s) => s.n > 0)
        .sort((a, b) => b.n - a.n || a.i - b.i)
        .slice(0, MAX_DIVIDED_PER_CHAPTER)
        .map((s) => s.i),
    );
    return {
      ...chapter,
      children: chapter.children.map((section, i) => {
        const split = splits[i];
        return split && chosen.has(i) ? withChildren(section, split, used) : section;
      }),
    };
  });
}
