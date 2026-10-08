/**
 * The in-page card's states (ADR-0125). Pinned: 401 is "Sign in"; no thesis is "Start one"; Save
 * waits for the lookup, so what is shown is what goes in; the save goes in by the identifier the
 * lookup found a record for, else by the paper's details; a refusal carries its reason and can be
 * tried again; a save the card did not start changes nothing.
 */

import { describe, expect, it } from 'vitest';
import { type CardView, canSave, cardInitial, reduceCard, saveRef } from '../src/card.js';
import type { Preview, SaveOneResult, Thesis } from '../src/messages.js';

const THESES: Thesis[] = [{ id: '0190a3c4-0000-7000-8000-000000000001', title: 'Groundwater' }];
const PREVIEW: Preview = {
  kind: 'doi',
  title: 'Groundwater Recharge',
  byline: 'Kavya Raman',
  year: 2017,
  venue: 'OJGS',
  doi: '10.5555/x1',
  citedBy: 54,
  openAccessVia: null,
};
const SAVED: SaveOneResult = {
  key: 'one',
  status: 'saved',
  sourceId: '0190a3c4-0000-7000-8000-000000000101',
  collection: null,
  signedOut: false,
  via: 'id',
};

const ready = (hasRefs = true): CardView =>
  reduceCard(cardInitial, { type: 'theses', reply: { ok: true, value: THESES }, hasRefs });

describe('opening the card', () => {
  it('asks the student to sign in on 401, and to start a thesis when there is none', () => {
    expect(
      reduceCard(cardInitial, {
        type: 'theses',
        reply: { ok: false, status: 401, message: 'signed out' },
        hasRefs: true,
      }),
    ).toEqual({ kind: 'signed-out' });
    expect(
      reduceCard(cardInitial, { type: 'theses', reply: { ok: true, value: [] }, hasRefs: true }),
    ).toEqual({ kind: 'no-thesis' });
  });

  it('says what went wrong when the site cannot be reached, and tries again', () => {
    const down = reduceCard(cardInitial, {
      type: 'theses',
      reply: { ok: false, status: 0, message: 'Thesis Copilot could not be reached.' },
      hasRefs: true,
    });
    expect(down).toEqual({ kind: 'unreachable', message: 'Thesis Copilot could not be reached.' });
    expect(reduceCard(down, { type: 'retry' })).toEqual({ kind: 'loading' });
  });

  it('looks the paper up when it has an identifier, and skips it when it has none', () => {
    expect(ready(true)).toMatchObject({ kind: 'ready', lookup: { state: 'looking' } });
    expect(ready(false)).toMatchObject({ kind: 'ready', lookup: { state: 'skipped' } });
  });
});

describe('saving', () => {
  it('waits for the lookup, then goes in by the identifier it found a record for', () => {
    const looking = ready(true);
    expect(canSave(looking)).toBe(false);
    expect(reduceCard(looking, { type: 'save-start' })).toBe(looking);
    const found = reduceCard(looking, {
      type: 'lookup',
      lookup: { state: 'found', ref: { kind: 'doi', id: '10.5555/x1' }, preview: PREVIEW },
    });
    expect(canSave(found)).toBe(true);
    expect(saveRef(found)).toEqual({ kind: 'doi', id: '10.5555/x1' });
    const saving = reduceCard(found, { type: 'save-start' });
    expect(saving).toMatchObject({ phase: 'saving' });
    expect(canSave(saving)).toBe(false);
    expect(
      reduceCard(saving, { type: 'save-done', reply: { ok: true, value: SAVED } }),
    ).toMatchObject({ phase: 'done', result: SAVED, error: null });
  });

  it('goes in by its details when no record was found, or there was nothing to look up', () => {
    const notFound = reduceCard(ready(true), {
      type: 'lookup',
      lookup: { state: 'not-found', message: 'No paper with that DOI' },
    });
    expect(canSave(notFound)).toBe(true);
    expect(saveRef(notFound)).toBeNull();
    expect(saveRef(ready(false))).toBeNull();
    expect(canSave(ready(false))).toBe(true);
  });

  it('keeps a refusal’s reason, offers to try again, and reads 401 as signed out', () => {
    const saving = reduceCard(ready(false), { type: 'save-start' });
    const refused = reduceCard(saving, {
      type: 'save-done',
      reply: {
        ok: true,
        value: {
          ...SAVED,
          status: 'failed',
          sourceId: null,
          message: 'Your monthly limit is used.',
        },
      },
    });
    expect(refused).toMatchObject({
      phase: 'done',
      result: { message: 'Your monthly limit is used.' },
    });
    expect(canSave(refused)).toBe(true);
    const broken = reduceCard(saving, {
      type: 'save-done',
      reply: { ok: false, status: 0, message: 'The add-on did not answer.' },
    });
    expect(broken).toMatchObject({ phase: 'done', error: 'The add-on did not answer.' });
    expect(canSave(broken)).toBe(true);
    expect(
      reduceCard(saving, {
        type: 'save-done',
        reply: { ok: false, status: 401, message: 'signed out' },
      }),
    ).toEqual({ kind: 'signed-out' });
    expect(
      reduceCard(saving, {
        type: 'save-done',
        reply: { ok: true, value: { ...SAVED, status: 'failed', signedOut: true } },
      }),
    ).toEqual({ kind: 'signed-out' });
  });

  it('does not save twice, and ignores an answer to a save it did not start', () => {
    const done = reduceCard(reduceCard(ready(false), { type: 'save-start' }), {
      type: 'save-done',
      reply: { ok: true, value: SAVED },
    });
    expect(canSave(done)).toBe(false);
    expect(reduceCard(done, { type: 'save-start' })).toBe(done);
    const idle = ready(false);
    expect(reduceCard(idle, { type: 'save-done', reply: { ok: true, value: SAVED } })).toBe(idle);
  });
});
