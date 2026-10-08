import { describe, expect, it } from 'vitest';
import { citationNotice } from '../src/lib/word-import-notice';

describe('why a Word import’s citations were not linked (Jenni build plan R34)', () => {
  it('says the file has no references section, and what to do instead', () => {
    const notice = citationNotice({ citationLike: 3, references: [] });
    expect(notice.tone).toBe('warn');
    expect(notice.title).toBe('3 citations not linked');
    expect(notice.lines[0]).toBe(
      'The file has no references section — a heading such as “References” or “Bibliography” — so nothing in it says which paper each citation means. They stay as text.',
    );
    expect(notice.lines[1]).toContain('Citations tab → Paste a reference');
  });

  it('speaks of one citation as one', () => {
    const notice = citationNotice({ citationLike: 1, references: [] });
    expect(notice.title).toBe('1 citation not linked');
    expect(notice.lines[0]).toContain('which paper the citation means. It stays as text.');
    expect(notice.lines[1]).toMatch(/^To link it,/);
  });

  it('still says so when there were no citations and no references section', () => {
    const notice = citationNotice({ citationLike: 0, references: [] });
    expect(notice.tone).toBe('info');
    expect(notice.title).toBe('No citations found');
    expect(notice.lines[0]).toContain('no references section');
  });

  it('with a references section, says why the citations still stay as text and where the list went', () => {
    const notice = citationNotice({
      citationLike: 2,
      references: [{ heading: 'References', chapter: 'References', entries: 24 }],
    });
    expect(notice.tone).toBe('warn');
    expect(notice.lines[0]).toBe(
      'A citation in your thesis points at a paper in your library, and an import adds no papers, so the citations stay as text.',
    );
    expect(notice.lines[1]).toBe(
      'Your reference list — the chapter “References” (24 entries) — came in as text. Paste it into Citations tab → Paste a reference to add those papers to your library, then cite each one.',
    );
    expect(notice.lines[2]).toContain('builds its own reference list');
  });

  it('names the chapter a references heading sat in, and sums several lists', () => {
    const inside = citationNotice({
      citationLike: 1,
      references: [{ heading: 'Bibliography', chapter: 'Conclusion', entries: 1 }],
    });
    expect(inside.lines[1]).toContain('“Bibliography” in “Conclusion” (1 entry)');
    const several = citationNotice({
      citationLike: 4,
      references: [
        { heading: 'References', chapter: 'Introduction', entries: 10 },
        { heading: 'References', chapter: 'Methods', entries: 5 },
      ],
    });
    expect(several.lines[1]).toContain(
      '2 reference lists (15 entries), the first “References” in “Introduction”',
    );
  });

  it('says when a reference list came with no citation in the text', () => {
    const notice = citationNotice({
      citationLike: 0,
      references: [{ heading: 'References', chapter: 'Chapter 5', entries: 0 }],
    });
    expect(notice.tone).toBe('info');
    expect(notice.title).toBe('No citations found in the text');
    expect(notice.lines[0]).toContain('“References” in “Chapter 5” (nothing under it)');
  });
});
