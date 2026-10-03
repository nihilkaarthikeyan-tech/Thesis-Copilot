'use client';

/**
 * A diagram from the student's own structure — ADR-0049.
 *
 * The student types the steps and the links between them; the dialog lays them out and draws
 * them, and Insert adds the picture as an ordinary figure with the text kept on it, so selecting
 * it later opens it here again. No model and no outside service: what is drawn is what was typed.
 */

import { DIAGRAM_LIMITS, type DiagramSpec, diagramSpecSchema, parseDiagram } from '@tc/types';
import { drawDiagram } from '@tc/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

/** Print width, as for charts (ADR-0027); the height follows the diagram. */
const RENDER_WIDTH = 1600;
const RENDER_HEIGHT = 1000;

const EXAMPLE = `Raw fish -> Brining -> Solar dryer
Solar dryer -> Packaging : below 15% moisture
Weather data -> Solar dryer`;

export function DiagramDialog({
  open,
  initial,
  replacing,
  onClose,
  onInsert,
}: {
  open: boolean;
  initial: DiagramSpec | null;
  replacing: boolean;
  onClose: () => void;
  onInsert: (spec: DiagramSpec, png: Blob) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [direction, setDirection] = useState<DiagramSpec['direction']>('down');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? '');
    setDirection(initial?.direction ?? 'down');
    setSource(initial?.source ?? '');
    setError(null);
    sourceRef.current?.focus();
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const spec = useMemo(() => {
    const parsed = diagramSpecSchema.safeParse({ title, direction, source });
    return parsed.success ? parsed.data : null;
  }, [title, direction, source]);
  const parsed = useMemo(() => parseDiagram(source), [source]);
  const problem = parsed.problems[0] ?? null;
  const drawable = spec !== null && problem === null;

  useEffect(() => {
    const canvas = preview.current;
    if (!canvas) return;
    if (spec && drawable) drawDiagram(canvas, spec, parsed, { fit: true });
    else canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }, [spec, parsed, drawable]);

  async function insert() {
    if (!spec || !drawable) return;
    setBusy(true);
    setError(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = RENDER_WIDTH;
      canvas.height = RENDER_HEIGHT;
      // The height follows the diagram's own proportions (`fit`), so a tall flowchart prints
      // tall rather than shrunk into a wide frame.
      drawDiagram(canvas, spec, parsed, { fit: true });
      const png = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'),
      );
      await onInsert(spec, png);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The diagram could not be added.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  const field = 'w-full rounded-md border border-line-strong bg-paper px-2 py-1 text-sm text-ink';
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink/30 p-4 pt-10 sm:p-6 sm:pt-14">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="diagram-title"
        data-testid="diagram-dialog"
        className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-md border border-line bg-surface p-5 text-sm shadow-lg"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="diagram-title" className="text-lg font-bold">
            {replacing ? 'Edit diagram' : 'Insert a diagram'}
          </h2>
          <button type="button" className="text-xs text-muted underline" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          Write one step or link per line: <code>A -&gt; B</code>, a chain{' '}
          <code>A -&gt; B -&gt; C</code>, or a labelled link <code>A -&gt; B : words</code>. It is
          drawn exactly as written and added as a figure; the text stays with it so you can change
          it later.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]">
          <div className="space-y-2">
            <label className="block text-xs text-muted">
              Title
              <input
                className={field}
                maxLength={DIAGRAM_LIMITS.title}
                value={title}
                data-testid="diagram-title-input"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div className="flex gap-3 text-xs">
              {(['down', 'right'] as const).map((d) => (
                <label key={d} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="diagram-direction"
                    checked={direction === d}
                    onChange={() => setDirection(d)}
                  />
                  {d === 'down' ? 'Top to bottom' : 'Left to right'}
                </label>
              ))}
            </div>
            <label className="block text-xs text-muted">
              Steps and links
              <textarea
                ref={sourceRef}
                className={`${field} h-48 font-mono text-xs`}
                maxLength={DIAGRAM_LIMITS.source}
                placeholder={EXAMPLE}
                value={source}
                data-testid="diagram-source"
                spellCheck={false}
                onChange={(e) => setSource(e.target.value)}
              />
            </label>
          </div>
          <canvas
            ref={preview}
            width={640}
            height={400}
            data-testid="diagram-preview"
            aria-label="Diagram preview"
            className="w-full self-start rounded-md border border-line bg-white"
          />
        </div>

        {(source.trim() && problem) || error ? (
          <p role="alert" className="mt-2 text-xs text-warn">
            {error ?? problem}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-line-strong px-3 py-1.5 text-xs"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="diagram-insert"
            disabled={!drawable || busy}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-50"
            onClick={() => void insert()}
          >
            {busy ? 'Adding…' : replacing ? 'Update diagram' : 'Insert diagram'}
          </button>
        </div>
      </section>
    </div>
  );
}
