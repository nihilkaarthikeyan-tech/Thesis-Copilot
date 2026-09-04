/**
 * PHASES 1.7 — autosave controller (Appendix B.7). B.9 test 8, client half: the 409 flow.
 * (The server half — PUT /chapters/:id with a stale baseVersion → 409 — lives in apps/api.)
 */

import type { JSONContent } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AutosaveStatus, createAutosave, type SaveResult } from '../src/editor/autosave.js';

type Handler = () => void;

function fakeEditor(initial: JSONContent = { type: 'doc', content: [] }) {
  const handlers: Record<string, Handler[]> = { update: [], blur: [] };
  let json = initial;
  return {
    getJSON: () => json,
    on: (event: 'update' | 'blur', h: Handler) => handlers[event]?.push(h),
    off: (event: 'update' | 'blur', h: Handler) => {
      handlers[event] = (handlers[event] ?? []).filter((x) => x !== h);
    },
    type(text: string) {
      json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
      for (const h of handlers.update ?? []) h();
    },
    blur() {
      for (const h of handlers.blur ?? []) h();
    },
  };
}

let store: Record<string, string>;
const storage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
  removeItem: (k: string) => {
    delete store[k];
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  store = {};
});
afterEach(() => vi.useRealTimers());

describe('autosave (Appendix B.7)', () => {
  it('saves 2 s after the last change, with the current baseVersion', async () => {
    const editor = fakeEditor();
    const saves: Array<{ baseVersion: number }> = [];
    const save = vi.fn(async (_c: JSONContent, baseVersion: number): Promise<SaveResult> => {
      saves.push({ baseVersion });
      return { ok: true, version: baseVersion + 1 };
    });
    const auto = createAutosave({ editor, save, initialVersion: 3, storage, storageKey: 'ch1' });

    editor.type('a');
    editor.type('ab');
    await vi.advanceTimersByTimeAsync(1_900);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledTimes(1);
    expect(saves[0]?.baseVersion).toBe(3);
    expect(auto.version).toBe(4);
    expect(auto.status).toBe('saved');
  });

  it('writes a localStorage safety copy on every change and clears it after a save', async () => {
    const editor = fakeEditor();
    const auto = createAutosave({
      editor,
      save: async (_c, v) => ({ ok: true, version: v + 1 }),
      initialVersion: 1,
      storage,
      storageKey: 'ch1',
    });
    editor.type('unsaved');
    expect(JSON.parse(store.ch1 ?? '{}').content.content[0].content[0].text).toBe('unsaved');
    expect(auto.localDraft()?.baseVersion).toBe(1);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(store.ch1).toBeUndefined();
    expect(auto.localDraft()).toBeNull();
  });

  it('B.9 #8: a 409 conflict stops autosave and reports `conflict`', async () => {
    const editor = fakeEditor();
    const statuses: AutosaveStatus[] = [];
    const save = vi.fn(
      async (): Promise<SaveResult> => ({ ok: false, conflict: true, serverVersion: 9 }),
    );
    const auto = createAutosave({
      editor,
      save,
      initialVersion: 2,
      onStatus: (s) => statuses.push(s),
    });

    editor.type('mine');
    await vi.advanceTimersByTimeAsync(2_100);
    expect(auto.status).toBe('conflict');
    expect(statuses).toEqual(['dirty', 'saving', 'conflict']);

    // Further typing must not trigger any more saves.
    editor.type('mine again');
    await vi.advanceTimersByTimeAsync(40_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(auto.status).toBe('conflict');
  });

  it('flush() on blur or route change saves immediately', async () => {
    const editor = fakeEditor();
    const save = vi.fn(
      async (_c: JSONContent, v: number): Promise<SaveResult> => ({ ok: true, version: v + 1 }),
    );
    createAutosave({ editor, save, initialVersion: 1 });
    editor.type('x');
    editor.blur();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves every 30 s while dirty even if changes keep arriving', async () => {
    const editor = fakeEditor();
    const save = vi.fn(
      async (_c: JSONContent, v: number): Promise<SaveResult> => ({ ok: true, version: v + 1 }),
    );
    createAutosave({ editor, save, initialVersion: 1 });
    // Keep typing every second so the 2 s debounce never fires.
    for (let i = 0; i < 31; i++) {
      editor.type(`t${i}`);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps the change and reports `error` when the save fails, then retries', async () => {
    const editor = fakeEditor();
    let fail = true;
    const save = vi.fn(
      async (_c: JSONContent, v: number): Promise<SaveResult> =>
        fail ? { ok: false, error: 'network' } : { ok: true, version: v + 1 },
    );
    const auto = createAutosave({ editor, save, initialVersion: 1 });
    editor.type('x');
    await vi.advanceTimersByTimeAsync(2_100);
    expect(auto.status).toBe('error');
    fail = false;
    editor.type('xy');
    await vi.advanceTimersByTimeAsync(2_100);
    expect(auto.status).toBe('saved');
    expect(auto.version).toBe(2);
  });
});
