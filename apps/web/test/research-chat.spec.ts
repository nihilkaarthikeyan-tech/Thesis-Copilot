/**
 * A research question with no thesis — the web half's pure part (ADR-0132).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  addPaperToThesis,
  labelledCitations,
  paperKey,
  papersOfTurn,
  type ResearchPaper,
  shortThesisTitle,
  startThesisFromChat,
} from '../src/lib/research-chat';

const paper = (doi: string | null, title = `Paper ${doi}`): ResearchPaper => ({
  title,
  year: 2022,
  venue: 'Energy Policy',
  doi,
  inLibrary: false,
  reference: { raw: `${title}. Energy Policy. 2022`, ...(doi ? { doi } : {}) },
});

describe('research chat (web)', () => {
  it('lists each cited paper once, from the search or from a thesis', () => {
    const papers = papersOfTurn({
      id: 'a',
      role: 'assistant',
      text: 'x',
      citations: [
        { key: 'Sweb1#cabstract', sourceId: '', chunkId: '', label: 'A', beyond: paper('10.1/A') },
        { key: 'Sweb2#cabstract', sourceId: '', chunkId: '', label: 'A', beyond: paper('10.1/a') },
        { key: 'S1#c1', sourceId: 's', chunkId: 'c', label: 'B', paper: paper(null, 'B') },
        { key: 'S1#c2', sourceId: 's', chunkId: 'c2', label: 'C' },
      ],
    });
    expect(papers.map(paperKey)).toEqual(['10.1/a', 'b']);
  });

  it('labels a passage from a thesis with the thesis, shortened at a word', () => {
    const [web, mine] = labelledCitations([
      { key: 'Sweb1#cabstract', sourceId: '', chunkId: '', label: 'Solar study, 2021' },
      {
        key: 'S1#c1',
        sourceId: 's',
        chunkId: 'c',
        label: 'Rao 2022',
        thesis: { id: 't', title: 'Barriers to rooftop solar adoption among rural households' },
      },
    ]);
    expect(web?.label).toBe('Solar study, 2021');
    expect(mine?.label).toBe('Rao 2022 · Barriers to rooftop solar…');
    expect(shortThesisTitle('Short title')).toBe('Short title');
  });

  it('starts a thesis with the confirmed title, then sends only the chosen papers to its library', async () => {
    const call = vi.fn(async (path: string) =>
      path === '/documents' ? { id: 'doc-1', firstChapterId: 'ch-1' } : { queued: 2 },
    );
    const made = await startThesisFromChat(call as never, '  What limits solar?  ', [
      paper('10.1/a'),
      paper('10.1/b'),
    ]);
    expect(made).toEqual({ id: 'doc-1', firstChapterId: 'ch-1', queued: 2 });
    expect(call).toHaveBeenCalledTimes(2);
    const [, createInit] = call.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(createInit.body))).toEqual({
      title: 'What limits solar?',
      entryPath: 'A_TOPIC',
      start: 'writing',
    });
    const [resolvePath, resolveInit] = call.mock.calls[1] as unknown as [string, RequestInit];
    expect(resolvePath).toBe('/documents/doc-1/sources/resolve');
    expect(JSON.parse(String(resolveInit.body)).references).toEqual([
      paper('10.1/a').reference,
      paper('10.1/b').reference,
    ]);
  });

  it('with no paper ticked, creates the thesis and resolves nothing', async () => {
    const call = vi.fn(async () => ({ id: 'doc-2', firstChapterId: null }));
    expect(await startThesisFromChat(call as never, 'T', [])).toEqual({
      id: 'doc-2',
      firstChapterId: null,
      queued: 0,
    });
    expect(call).toHaveBeenCalledOnce();
  });

  it('adds one paper to the thesis chosen', async () => {
    const call = vi.fn(async () => ({ queued: 1, alreadyPresent: 0 }));
    await addPaperToThesis(call as never, 'doc-3', paper('10.1/z'));
    const [path, init] = call.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/documents/doc-3/sources/resolve');
    expect(JSON.parse(String(init.body))).toEqual({ references: [paper('10.1/z').reference] });
  });
});
