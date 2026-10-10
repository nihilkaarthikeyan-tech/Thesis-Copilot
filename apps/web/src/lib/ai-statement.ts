/**
 * The AI use statement (ADR-0148), put together in code from the facts the API counted
 * (`GET /documents/:id/ai-statement`). No model writes any of it: every number is a stored count,
 * every sentence a catalogue entry (en.ts / hi.ts), first person, and a feature the record shows
 * no use of is not mentioned. The student edits the result before copying it, inserting it as an
 * appendix, or sending it with an export.
 *
 * Where the record cannot tell — pasted text reads as the student's own; an edit is counted only
 * where the text was touched — the statement says so. Nothing here is about AI detection, and the
 * wording must never present it as such (PRD §12.3).
 */

import {
  AI_STATEMENT_FEATURES,
  type AiStatementFacts,
  type AiStatementFeature,
  type AiStatementTable,
} from '@tc/types';
import { type Language, type MessageKey, translate, type Vars } from '../i18n';

export type AiStatement = {
  title: string;
  paragraphs: string[];
  /** The per-chapter table, present when asked for and the thesis has chapters. */
  table: AiStatementTable | null;
};

/** How a feature's count becomes a sentence; absent from the map means "say nothing". */
const FEATURE_KEY: Record<AiStatementFeature, MessageKey> = {
  suggestions: 'aiStatement.f.suggestions.kept',
  drafting: 'aiStatement.f.drafting',
  edits: 'aiStatement.f.edits',
  proofreading: 'aiStatement.f.proofreading',
  citations: 'aiStatement.f.citations',
  chat: 'aiStatement.f.chat',
  research: 'aiStatement.f.research',
  literatureSearch: 'aiStatement.f.literatureSearch',
  planning: 'aiStatement.f.planning',
  checks: 'aiStatement.f.checks',
  chapterBuild: 'aiStatement.f.chapterBuild',
  litReviewBuild: 'aiStatement.f.litReviewBuild',
  examinerReview: 'aiStatement.f.examinerReview',
  viva: 'aiStatement.f.viva',
};

const LOCALE: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN' };

/** `1,234` in the interface's own digits. */
function num(language: Language, value: number): string {
  return new Intl.NumberFormat(LOCALE[language]).format(value);
}

/** `12 March 2026` in the interface language; the date is a UTC day, read as one. */
function date(language: Language, day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return new Intl.DateTimeFormat(LOCALE[language], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

const pct = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;

/** True when the record shows any AI feature used at all. */
export function anyFeatureUsed(facts: AiStatementFacts): boolean {
  return AI_STATEMENT_FEATURES.some((f) => facts.features[f] > 0);
}

/** The sentences for the features the record shows used, in the catalogue's order. */
export function featureSentences(facts: AiStatementFacts, language: Language): string[] {
  const t = (key: MessageKey, vars?: Vars) => translate(language, key, vars);
  const n = (value: number) => num(language, value);
  const out: string[] = [];
  for (const feature of AI_STATEMENT_FEATURES) {
    const count = facts.features[feature];
    if (count <= 0) continue;
    switch (feature) {
      case 'suggestions':
        out.push(
          facts.suggestions.kept > 0
            ? t('aiStatement.f.suggestions.kept', {
                shown: n(facts.suggestions.shown),
                kept: n(facts.suggestions.kept),
              })
            : t('aiStatement.f.suggestions.none', { shown: n(facts.suggestions.shown) }),
        );
        break;
      case 'drafting':
        out.push(
          t('aiStatement.f.drafting', {
            n: n(facts.drafts.shown),
            accepted: n(facts.drafts.accepted),
          }),
        );
        break;
      case 'litReviewBuild':
        out.push(t(FEATURE_KEY[feature]));
        break;
      default:
        out.push(t(FEATURE_KEY[feature], { n: n(count) }));
    }
  }
  return out;
}

export function buildAiStatement(
  facts: AiStatementFacts,
  language: Language,
  options: { table?: boolean } = {},
): AiStatement {
  const t = (key: MessageKey, vars?: Vars) => translate(language, key, vars);
  const n = (value: number) => num(language, value);
  const paragraphs: string[] = [];

  const used = anyFeatureUsed(facts);
  if (used) {
    paragraphs.push(
      facts.from && facts.to
        ? t('aiStatement.p.open', {
            title: facts.documentTitle,
            from: date(language, facts.from),
            to: date(language, facts.to),
          })
        : t('aiStatement.p.openNoDates', { title: facts.documentTitle }),
    );
    paragraphs.push(featureSentences(facts, language).join(' '));
    paragraphs.push(t('aiStatement.p.action'));
  } else {
    paragraphs.push(t('aiStatement.p.openNone', { title: facts.documentTitle }));
  }

  const { total, aiUnedited, aiEdited, own } = facts.words;
  const ai = aiUnedited + aiEdited;
  if (total === 0) {
    paragraphs.push(t('aiStatement.p.shareEmpty'));
  } else if (ai === 0) {
    paragraphs.push(t('aiStatement.p.shareNone', { total: n(total) }));
  } else {
    paragraphs.push(
      t('aiStatement.p.share', {
        total: n(total),
        ai: n(ai),
        aiPct: pct(ai, total),
        edited: n(aiEdited),
        editedPct: pct(aiEdited, ai),
        own: n(own),
        ownPct: pct(own, total),
      }),
    );
  }
  paragraphs.push(t('aiStatement.p.limits'));

  const { sources } = facts;
  if (sources.total === 0) {
    paragraphs.push(t('aiStatement.p.sourcesNone'));
  } else if (sources.autoAdded === 0) {
    paragraphs.push(
      t('aiStatement.p.sourcesOwn', { total: n(sources.total), cited: n(sources.cited) }),
    );
  } else {
    paragraphs.push(
      t('aiStatement.p.sources', {
        total: n(sources.total),
        cited: n(sources.cited),
        auto: n(sources.autoAdded),
      }),
    );
  }
  paragraphs.push(t('aiStatement.p.close'));

  return {
    title: t('aiStatement.heading'),
    paragraphs,
    table: options.table ? chapterTable(facts, language) : null,
  };
}

/** One row a chapter, in the order of the outline, and a total; null for a thesis with none. */
export function chapterTable(facts: AiStatementFacts, language: Language): AiStatementTable | null {
  if (facts.chapters.length === 0) return null;
  const t = (key: MessageKey) => translate(language, key);
  const n = (value: number) => num(language, value);
  const rows = facts.chapters.map((c) => [
    c.title,
    n(c.total),
    n(c.aiUnedited + c.aiEdited),
    n(c.aiEdited),
    n(c.own),
    n(c.actions),
  ]);
  const w = facts.words;
  rows.push([
    t('aiStatement.t.total'),
    n(w.total),
    n(w.aiUnedited + w.aiEdited),
    n(w.aiEdited),
    n(w.own),
    n(facts.chapters.reduce((sum, c) => sum + c.actions, 0)),
  ]);
  return {
    header: [
      t('aiStatement.t.chapter'),
      t('aiStatement.t.words'),
      t('aiStatement.t.ai'),
      t('aiStatement.t.edited'),
      t('aiStatement.t.own'),
      t('aiStatement.t.actions'),
    ],
    rows,
  };
}

/** The statement as plain text: the title, a blank line, the paragraphs, the table as lines. */
export function statementToText(statement: AiStatement): string {
  const lines = [statement.title, '', statement.paragraphs.join('\n\n')];
  if (statement.table) {
    lines.push('', statement.table.header.join(' | '));
    for (const row of statement.table.rows) lines.push(row.join(' | '));
  }
  return lines.join('\n');
}

/** The textarea's text back into paragraphs: blank lines separate them, nothing else does. */
export function paragraphsFromText(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/**
 * The table as lines of text, for an export whose appendix takes paragraphs only: one line per
 * chapter, each cell named by its column.
 */
export function tableAsParagraphs(table: AiStatementTable): string[] {
  const [, ...columns] = table.header;
  return table.rows.map((row) => {
    const [name, ...cells] = row;
    return `${name}: ${cells.map((cell, i) => `${columns[i] ?? ''} ${cell}`).join('; ')}.`;
  });
}
