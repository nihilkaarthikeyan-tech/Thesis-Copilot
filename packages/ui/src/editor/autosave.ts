/**
 * Autosave controller — PRD Appendix B.7, FR-4.1.
 *
 * Debounce 2 s after the last document change; also on blur, on route change (`flush`), and every
 * 30 s while dirty. Every debounce also writes a localStorage safety copy so a killed tab loses at
 * most the debounce window. A 409 (another tab saved first) freezes autosave and surfaces
 * `conflict`; the app tells the student to reload.
 *
 * Framework-agnostic: takes an editor with `on/off/getJSON` and an injected `save`, so the API
 * client and the tests both plug in.
 */

import type { JSONContent } from '@tiptap/core';

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';

export type SaveResult =
  | { ok: true; version: number; savedAt?: string }
  | { ok: false; conflict: true; serverVersion?: number }
  | { ok: false; conflict?: false; error: string };

type EditorLike = {
  getJSON: () => JSONContent;
  on: (event: 'update' | 'blur', handler: () => void) => unknown;
  off: (event: 'update' | 'blur', handler: () => void) => unknown;
  isDestroyed?: boolean;
};

export type AutosaveOptions = {
  editor: EditorLike;
  save: (content: JSONContent, baseVersion: number) => Promise<SaveResult>;
  initialVersion: number;
  /** localStorage key for the safety copy; omit to disable. */
  storageKey?: string;
  debounceMs?: number;
  intervalMs?: number;
  onStatus?: (status: AutosaveStatus, detail?: { version?: number; error?: string }) => void;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
};

export type LocalDraft = { content: JSONContent; savedAt: number; baseVersion: number };

export type Autosave = {
  readonly status: AutosaveStatus;
  readonly version: number;
  /** Save now if dirty (blur, route change, Ctrl+S). Resolves when the save settles. */
  flush: () => Promise<void>;
  stop: () => void;
  /** A newer unsaved copy from a previous session, if any (B.7 "offer to restore"). */
  localDraft: () => LocalDraft | null;
  clearLocalDraft: () => void;
};

export function createAutosave(options: AutosaveOptions): Autosave {
  const debounceMs = options.debounceMs ?? 2_000;
  const intervalMs = options.intervalMs ?? 30_000;
  const storage =
    options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);

  let status: AutosaveStatus = 'idle';
  let version = options.initialVersion;
  let dirty = false;
  let inFlight: Promise<void> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const setStatus = (next: AutosaveStatus, detail?: { version?: number; error?: string }) => {
    status = next;
    options.onStatus?.(next, detail);
  };

  const writeLocal = () => {
    if (!options.storageKey || !storage) return;
    try {
      const draft: LocalDraft = {
        content: options.editor.getJSON(),
        savedAt: Date.now(),
        baseVersion: version,
      };
      storage.setItem(options.storageKey, JSON.stringify(draft));
    } catch {
      // Storage full or unavailable: the server save is the real one.
    }
  };

  const clearLocalDraft = () => {
    if (!options.storageKey || !storage) return;
    try {
      storage.removeItem(options.storageKey);
    } catch {
      /* ignore */
    }
  };

  const doSave = async (): Promise<void> => {
    if (stopped || status === 'conflict' || !dirty) return;
    dirty = false;
    setStatus('saving');
    const content = options.editor.getJSON();
    try {
      const result = await options.save(content, version);
      if (result.ok) {
        version = result.version;
        clearLocalDraft();
        setStatus(dirty ? 'dirty' : 'saved', { version });
      } else if (result.conflict) {
        // B.7: stop autosaving; the student must reload.
        stop();
        setStatus('conflict', { version: result.serverVersion });
      } else {
        dirty = true;
        setStatus('error', { error: result.error });
      }
    } catch (error) {
      dirty = true;
      setStatus('error', { error: error instanceof Error ? error.message : String(error) });
    }
  };

  const save = (): Promise<void> => {
    if (inFlight) return inFlight.then(() => (dirty ? save() : undefined));
    inFlight = doSave().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const onUpdate = () => {
    if (stopped || status === 'conflict') return;
    dirty = true;
    setStatus('dirty');
    writeLocal();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void save();
    }, debounceMs);
    if (!intervalTimer) {
      intervalTimer = setInterval(() => {
        if (dirty) void save();
      }, intervalMs);
    }
  };

  const onBlur = () => {
    if (dirty) void flush();
  };

  const flush = async (): Promise<void> => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (dirty) await save();
    else if (inFlight) await inFlight;
  };

  function stop(): void {
    stopped = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    debounceTimer = null;
    intervalTimer = null;
    options.editor.off('update', onUpdate);
    options.editor.off('blur', onBlur);
  }

  options.editor.on('update', onUpdate);
  options.editor.on('blur', onBlur);

  return {
    get status() {
      return status;
    },
    get version() {
      return version;
    },
    flush,
    stop,
    localDraft: () => {
      if (!options.storageKey || !storage) return null;
      try {
        const raw = storage.getItem(options.storageKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as LocalDraft;
        return parsed.baseVersion >= version ? parsed : null;
      } catch {
        return null;
      }
    },
    clearLocalDraft,
  };
}
