/**
 * The popup's states (ADR-0069). What is pinned: a page with nothing on it ends at "not a paper";
 * 401 is "sign in", never an error; no thesis is "start one"; a failed save keeps the paper ticked
 * so "Try again" sends it, and a saved one is never sent twice; one save sends at most fifty.
 */

import { describe, expect, it } from 'vitest';
import type { ListItem } from '../src/lists.js';
import type { ItemResult, SaveResult } from '../src/messages.js';
import {
  type Event,
  initial,
  overCap,
  pendingKeys,
  reduce,
  singleResult,
  type Target,
  tally,
  type View,
} from '../src/state.js';

const paper = {
  title: 'Deep learning',
  doi: '10.1038/nature14539',
  reference: 'LeCun (2015). Deep learning.',
};
const single: Target = { mode: 'single', key: paper.doi, paper, pdf: null, fromLink: false };
const item = (n: number): ListItem => ({
  key: `10.48550/arxiv.2601.${10000 + n}`,
  title: `Paper ${n}`,
  doi: `10.48550/arxiv.2601.${10000 + n}`,
  reference: `Paper ${n}.`,
});
const list = (n: number): Target => ({
  mode: 'list',
  site: 'arxiv',
  items: Array.from({ length: n }, (_, i) => item(i)),
});
const theses = [{ id: '0190a3c4-0000-7000-8000-000000000001', title: 'Groundwater' }];

const run = (events: Event[], from: View = initial): View => events.reduce(reduce, from);
const ready = (target: Target) =>
  run([
    { type: 'read', target, restricted: false },
    { type: 'theses', reply: { ok: true, value: theses } },
  ]);
const done = (results: ItemResult[], extra: Partial<SaveResult> = {}): Event => ({
  type: 'save-done',
  reply: { ok: true, value: { results, pdf: null, collection: null, signedOut: false, ...extra } },
});

describe('before saving', () => {
  it('a page with no paper is “not a paper”, a Chrome page is “restricted”', () => {
    expect(run([{ type: 'read', target: null, restricted: false }])).toEqual({
      kind: 'not-paper',
      restricted: false,
    });
    expect(run([{ type: 'read', target: null, restricted: true }])).toEqual({
      kind: 'not-paper',
      restricted: true,
    });
  });

  it('401 is “sign in”; no thesis is “start one”; any other failure can be retried', () => {
    const loading = run([{ type: 'read', target: single, restricted: false }]);
    expect(loading.kind).toBe('loading');
    expect(
      reduce(loading, { type: 'theses', reply: { ok: false, status: 401, message: 'x' } }).kind,
    ).toBe('signed-out');
    expect(reduce(loading, { type: 'theses', reply: { ok: true, value: [] } }).kind).toBe(
      'no-thesis',
    );
    const failed = reduce(loading, {
      type: 'theses',
      reply: { ok: false, status: 0, message: 'offline' },
    });
    expect(failed).toMatchObject({ kind: 'load-failed', message: 'offline' });
    expect(reduce(failed, { type: 'retry-load' }).kind).toBe('loading');
  });

  it('one paper is selected; on a results page nothing is until the student ticks', () => {
    expect(ready(single)).toMatchObject({ kind: 'ready', selected: [paper.doi], phase: 'idle' });
    const page = ready(list(3));
    expect(page).toMatchObject({ selected: [] });
    expect(pendingKeys(page)).toEqual([]);
    const ticked = reduce(page, { type: 'toggle', key: item(1).key });
    expect(pendingKeys(ticked)).toEqual([item(1).key]);
    expect(pendingKeys(reduce(ticked, { type: 'toggle', key: item(1).key }))).toEqual([]);
    // A key that is not on the page is ignored.
    expect(reduce(page, { type: 'toggle', key: 'nope' })).toBe(page);
  });

  it('“select all” takes at most fifty, and a second press clears', () => {
    const page = ready(list(70));
    const all = reduce(page, { type: 'toggle-all' });
    expect(pendingKeys(all)).toHaveLength(50);
    expect(overCap(all)).toBe(false);
    expect(pendingKeys(reduce(all, { type: 'toggle-all' }))).toEqual([]);
    // Ticked one by one past fifty: one save still sends fifty, and says so.
    const many =
      list(70).mode === 'list' ? (list(70) as Extract<Target, { mode: 'list' }>).items : [];
    const ticked = many.reduce<View>((v, i) => reduce(v, { type: 'toggle', key: i.key }), page);
    expect(pendingKeys(ticked)).toHaveLength(50);
    expect(overCap(ticked)).toBe(true);
  });
});

describe('saving one paper', () => {
  it('saving → saved, with the source id for “Open in Thesis Copilot”', () => {
    const saving = reduce(ready(single), { type: 'save-start' });
    expect(saving).toMatchObject({ phase: 'saving', sending: [paper.doi] });
    // A second press while saving does nothing.
    expect(reduce(saving, { type: 'save-start' })).toBe(saving);
    const saved = reduce(saving, done([{ key: paper.doi, status: 'saved', sourceId: 'S1' }]));
    expect(saved).toMatchObject({ phase: 'done' });
    expect(singleResult(saved)).toEqual({ key: paper.doi, status: 'saved', sourceId: 'S1' });
    expect(pendingKeys(saved)).toEqual([]);
  });

  it('already in the library is its own state, not an error', () => {
    const v = run(
      [{ type: 'save-start' }, done([{ key: paper.doi, status: 'present', sourceId: 'S0' }])],
      ready(single),
    );
    expect(singleResult(v)?.status).toBe('present');
  });

  it('a failure keeps the paper selected so “Try again” sends it again', () => {
    const failed = run(
      [
        { type: 'save-start' },
        done([{ key: paper.doi, status: 'failed', sourceId: null, message: 'Limit reached' }]),
      ],
      ready(single),
    );
    expect(pendingKeys(failed)).toEqual([paper.doi]);
    const again = reduce(failed, { type: 'save-start' });
    expect(again).toMatchObject({ phase: 'saving' });
    expect(singleResult(again)).toBeNull();
  });

  it('the whole save failing is an error with retry; signed out part-way is “sign in”', () => {
    const saving = reduce(ready(single), { type: 'save-start' });
    expect(
      reduce(saving, { type: 'save-done', reply: { ok: false, status: 0, message: 'offline' } }),
    ).toMatchObject({
      phase: 'done',
      error: 'offline',
    });
    expect(
      reduce(saving, { type: 'save-done', reply: { ok: false, status: 401, message: '' } }).kind,
    ).toBe('signed-out');
    expect(reduce(saving, done([], { signedOut: true })).kind).toBe('signed-out');
  });
});

describe('saving a results page', () => {
  it('shows progress, then per paper: saved, already there, failed — and retries only the failed', () => {
    let v = reduce(ready(list(3)), { type: 'toggle-all' });
    v = reduce(v, { type: 'save-start' });
    v = reduce(v, {
      type: 'progress',
      results: [{ key: item(0).key, status: 'present', sourceId: 'A' }],
    });
    expect(v.kind === 'ready' && v.results[item(0).key]?.status).toBe('present');
    v = reduce(
      v,
      done([
        { key: item(0).key, status: 'present', sourceId: 'A' },
        { key: item(1).key, status: 'saved', sourceId: 'B' },
        { key: item(2).key, status: 'failed', sourceId: null, message: 'x' },
      ]),
    );
    expect(tally(v)).toEqual({ saved: 1, present: 1, failed: 1 });
    expect(pendingKeys(v)).toEqual([item(2).key]);
    // Saved papers cannot be unticked into being sent again; select-all now means the failed one.
    expect(pendingKeys(reduce(reduce(v, { type: 'toggle-all' }), { type: 'toggle-all' }))).toEqual([
      item(2).key,
    ]);
    const retry = reduce(v, { type: 'save-start' });
    expect(retry).toMatchObject({ phase: 'saving', sending: [item(2).key] });
  });

  it('ignores progress for a save that is not running, and ticks while saving', () => {
    const v = ready(list(2));
    expect(reduce(v, { type: 'progress', results: [] })).toBe(v);
    const saving = reduce(reduce(v, { type: 'toggle-all' }), { type: 'save-start' });
    expect(reduce(saving, { type: 'toggle', key: item(0).key })).toBe(saving);
  });
});
