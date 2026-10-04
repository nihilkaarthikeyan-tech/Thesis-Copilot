'use client';

/**
 * "From Zotero" — ADR-0062 (ADR-0059 row 36).
 *
 * The student pastes their Zotero user ID and a read-only key; "Check key" lists their collections
 * and "Import" reads the whole library or one collection once into the resolve pipeline. The key
 * lives in this component's state while the dialog is open and is cleared when it closes; the
 * server uses it for the request and keeps nothing.
 */

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ApiError, api } from '@/lib/api';

/** Where a student makes a key (`ZOTERO_KEYS_URL` in `@tc/retrieval`). */
const KEYS_URL = 'https://www.zotero.org/settings/keys';

type Collection = { key: string; name: string; parentKey: string | null; numItems: number | null };

export type ZoteroImportResult = {
  entries: number;
  skipped: number;
  notReferences: number;
  queued: number;
  alreadyPresent: number;
};

/** "Thesis / Chapter 2", so nested collections with one name can be told apart. */
function labelOf(collection: Collection, all: Collection[]): string {
  const names = [collection.name];
  let parent = collection.parentKey;
  for (let depth = 0; parent && depth < 5; depth++) {
    const up = all.find((c) => c.key === parent);
    if (!up) break;
    names.unshift(up.name);
    parent = up.parentKey;
  }
  const count = collection.numItems === null ? '' : ` (${collection.numItems})`;
  return `${names.join(' / ')}${count}`;
}

export function ZoteroImport({
  documentId,
  onImported,
}: {
  documentId: string;
  onImported: (result: ZoteroImportResult) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [collectionKey, setCollectionKey] = useState('');
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    // The key goes when the dialog does.
    setApiKey('');
    setCollections(null);
    setCollectionKey('');
    setError(null);
  }

  const credentials = () => ({ userId: userId.trim(), apiKey: apiKey.trim() });

  async function check(event: FormEvent) {
    event.preventDefault();
    setBusy('check');
    setError(null);
    try {
      const result = await api<{ collections: Collection[] }>(
        `/documents/${documentId}/sources/zotero/collections`,
        { method: 'POST', body: JSON.stringify(credentials()) },
      );
      setCollections(result.collections);
      setCollectionKey('');
    } catch (e) {
      setCollections(null);
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not check the key.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    setBusy('import');
    setError(null);
    try {
      const result = await api<ZoteroImportResult>(
        `/documents/${documentId}/sources/zotero/import`,
        {
          method: 'POST',
          body: JSON.stringify({ ...credentials(), collectionKey: collectionKey || null }),
        },
      );
      close();
      await onImported(result);
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'That import did not work.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="zotero-open"
        className="rounded-md border border-line px-3 py-2 text-sm hover:bg-paper"
      >
        From Zotero
      </button>
      <Dialog open={open} onClose={close} title="Import from Zotero" testId="zotero-dialog">
        <p className="text-muted">
          Reads your Zotero library once and looks each reference up. Nothing stays linked, and your
          key is used for this import only — it is not saved.
        </p>
        <p className="mt-2 text-muted">
          On{' '}
          <a href={KEYS_URL} target="_blank" rel="noreferrer" className="text-accent underline">
            zotero.org/settings/keys
          </a>
          , create a new private key that can read your library and nothing more (leave write access
          off), and paste it below. Your user ID is the number shown on the same page.
        </p>

        <form onSubmit={check} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            Zotero user ID
            <input
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setCollections(null);
              }}
              inputMode="numeric"
              autoComplete="off"
              required
              className="h-9 rounded-md border border-line px-2 text-sm font-normal"
              placeholder="e.g. 4419137"
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            API key (read-only)
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setCollections(null);
              }}
              autoComplete="off"
              spellCheck={false}
              required
              className="h-9 rounded-md border border-line px-2 font-mono text-sm font-normal"
            />
          </label>
          {collections === null ? (
            <Button
              type="submit"
              variant="secondary"
              className="self-start"
              disabled={busy !== null || !userId.trim() || !apiKey.trim()}
            >
              {busy === 'check' ? 'Checking…' : 'Check key'}
            </Button>
          ) : null}
        </form>

        {collections !== null ? (
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[13px] font-semibold">
              What to import
              <select
                value={collectionKey}
                onChange={(e) => setCollectionKey(e.target.value)}
                data-testid="zotero-collection"
                className="h-9 rounded-md border border-line bg-surface px-2 text-sm font-normal"
              >
                <option value="">The whole library</option>
                {collections.map((c) => (
                  <option key={c.key} value={c.key}>
                    {labelOf(c, collections)}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-muted">
              Up to 500 items at a time; notes and attachments are left out.
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          {collections !== null ? (
            <Button
              onClick={() => void runImport()}
              disabled={busy !== null}
              data-testid="zotero-import"
            >
              {busy === 'import' ? 'Importing…' : 'Import'}
            </Button>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
