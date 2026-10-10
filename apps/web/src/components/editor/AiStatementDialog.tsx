'use client';

/**
 * The AI use statement (ADR-0148), from the editor's ⋯ menu. The facts come from the API, the
 * sentences from `lib/ai-statement.ts` in the interface language, and the text sits in a textarea
 * the student edits before doing anything with it. Copy puts it on the clipboard; Insert as an
 * appendix makes it the last chapter — an ordinary one, by the student's press (flag, don't fix).
 */

import type { AiStatementFacts } from '@tc/types';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { useT } from '@/i18n/react';
import {
  type AiStatement,
  buildAiStatement,
  paragraphsFromText,
  statementToText,
} from '@/lib/ai-statement';
import { ApiError, api } from '@/lib/api';

export function AiStatementDialog({
  open,
  onClose,
  documentId,
}: {
  open: boolean;
  onClose: () => void;
  documentId: string;
}) {
  const { t, language } = useT();
  const router = useRouter();
  const [facts, setFacts] = useState<AiStatementFacts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withTable, setWithTable] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  /** Set once the student has typed, so a rebuild (table toggled) does not throw their edits away. */
  const [touched, setTouched] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api<AiStatementFacts>(`/documents/${documentId}/ai-statement`)
      .then(setFacts)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.problem.title : t('aiStatement.loadError')),
      );
  }, [open, documentId, t]);

  const built: AiStatement | null = useMemo(
    () => (facts ? buildAiStatement(facts, language, { table: withTable }) : null),
    [facts, language, withTable],
  );

  // The generated text fills the box until the student edits it; the title likewise.
  useEffect(() => {
    if (!built || touched) return;
    setTitle(built.title);
    setText(built.paragraphs.join('\n\n'));
  }, [built, touched]);

  const table = withTable ? (built?.table ?? null) : null;

  async function copy() {
    const statement: AiStatement = { title, paragraphs: paragraphsFromText(text), table };
    try {
      await navigator.clipboard.writeText(statementToText(statement));
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  async function insert() {
    const paragraphs = paragraphsFromText(text);
    if (paragraphs.length === 0 || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ chapterId: string; title: string }>(
        `/documents/${documentId}/ai-statement/appendix`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: title.trim(),
            paragraphs,
            ...(table ? { table } : {}),
          }),
        },
      );
      // The new chapter opens; the editor route changes and the dialog goes with it.
      router.push(`/app/d/${documentId}/write/${result.chapterId}`);
      onClose();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : t('aiStatement.insertError'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('aiStatement.title')}
      testId="ai-statement-dialog"
      size="wide"
    >
      <div className="min-w-0 space-y-3">
        <p className="text-xs text-muted">{t('aiStatement.intro')}</p>

        {error ? (
          <p role="alert" className="text-sm text-warn">
            {error}
          </p>
        ) : null}

        {!facts && !error ? (
          <p className="text-sm text-muted" data-testid="ai-statement-loading">
            {t('aiStatement.loading')}
          </p>
        ) : null}

        {facts ? (
          <>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTouched(true);
                setTitle(e.target.value);
              }}
              aria-label={t('aiStatement.heading')}
              data-testid="ai-statement-title"
              className="w-full min-w-0 rounded-md border border-line-strong bg-surface px-2 py-1 text-sm font-semibold text-ink"
            />
            <label className="block min-w-0 text-xs text-muted">
              {t('aiStatement.editLabel')}
              <textarea
                value={text}
                onChange={(e) => {
                  setTouched(true);
                  setText(e.target.value);
                }}
                rows={14}
                data-testid="ai-statement-text"
                className="mt-1 w-full min-w-0 resize-y rounded-md border border-line-strong bg-surface px-2 py-1.5 text-[13px] leading-relaxed text-ink"
              />
            </label>
            <label className="flex min-w-0 items-start gap-2 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={withTable}
                onChange={(e) => setWithTable(e.target.checked)}
                data-testid="ai-statement-table"
                className="mt-0.5"
              />
              <span className="min-w-0">{t('aiStatement.table')}</span>
            </label>
            {table ? (
              <div className="min-w-0 overflow-x-auto rounded-md border border-line">
                <table
                  className="w-full min-w-[32rem] border-collapse text-[12px]"
                  data-testid="ai-statement-table-preview"
                >
                  <thead>
                    <tr className="bg-sunk text-left">
                      {table.header.map((h) => (
                        <th key={h} className="border-b border-line px-2 py-1 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: rows of a fixed table, in order.
                      <tr key={i} className={i === table.rows.length - 1 ? 'font-semibold' : ''}>
                        {row.map((cell, j) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: as above.
                          <td key={j} className="tnum border-b border-line px-2 py-1">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="ai-statement-insert"
            disabled={!facts || busy || paragraphsFromText(text).length === 0}
            onClick={() => void insert()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? t('aiStatement.inserting') : t('aiStatement.insert')}
          </button>
          <button
            type="button"
            data-testid="ai-statement-copy"
            disabled={!facts}
            onClick={() => void copy()}
            className="rounded-md border border-line-strong px-3 py-2 text-sm text-ink hover:bg-sunk disabled:opacity-50"
          >
            {copied ? t('aiStatement.copied') : t('aiStatement.copy')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line-strong px-3 py-2 text-sm text-ink hover:bg-sunk"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
