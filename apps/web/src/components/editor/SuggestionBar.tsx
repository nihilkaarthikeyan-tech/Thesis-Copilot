'use client';

/**
 * The suggestion bar: what to do with a suggestion, on screen (2026-10-04, from the Jenni study).
 *
 * A suggestion could only be kept with Tab or →, so on a phone — no Tab key — it could be read but
 * never kept, and on a laptop the student had to know the keys. Jenni shows Accept / Refine under
 * every suggestion. This does the same with our commands, and adds refine presets.
 *
 * A preset is a guided suggestion (Shift+→) with the instruction written for the student: the same
 * A.1 path, the same grounding rules, no new prompt. Asking again uses one Assist suggestion, as
 * every suggestion does, so the menu says so.
 */

import { getGhostState } from '@tc/ui';
import type { Editor } from '@tiptap/react';
import { useEffect, useState } from 'react';

/** The presets: each is an instruction the guided suggestion already accepts. */
export const REFINE_PRESETS: Array<{ label: string; instruction: string }> = [
  { label: 'Shorter', instruction: 'Say the same thing in fewer words.' },
  { label: 'More formal', instruction: 'Use a more formal academic register.' },
  {
    label: 'Stay closer to my topic',
    instruction: 'Stay strictly on the topic of this paragraph and this chapter.',
  },
  {
    label: 'Complete this paragraph',
    instruction: 'Finish the current paragraph rather than starting a new point.',
  },
  {
    label: 'A contrasting finding',
    instruction:
      'Give a finding from the sources that contrasts with or qualifies the previous sentence, if one exists.',
  },
];

type Status = 'idle' | 'requesting' | 'streaming' | 'shown' | string;

export function SuggestionBar({
  editor,
  onRefine,
}: {
  editor: Editor | null;
  /** Asks the student for their own instruction (the guided input) and resolves with it. */
  onRefine: () => Promise<string | null>;
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!editor) return;
    const update = () => setStatus(getGhostState(editor)?.status ?? 'idle');
    update();
    editor.on('transaction', update);
    return () => {
      editor.off('transaction', update);
    };
  }, [editor]);

  useEffect(() => {
    if (status === 'idle') setMenu(false);
  }, [status]);

  if (!editor || status === 'idle') return null;

  const ask = (instruction: string) => {
    setMenu(false);
    editor.commands.dismissSuggestion();
    editor.commands.requestSuggestion(instruction);
  };

  const shown = status === 'shown';
  const button =
    'rounded-md border border-line px-2.5 py-1.5 text-[12.5px] font-medium hover:bg-sunk disabled:opacity-40';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex justify-center px-4 lg:bottom-6">
      <div
        data-testid="suggestion-bar"
        className="pointer-events-auto relative flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 shadow-lg"
      >
        <span className="text-[12px] text-muted">{shown ? 'Suggestion' : 'Writing…'}</span>
        <button
          type="button"
          disabled={!shown}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.commands.acceptSuggestion()}
          className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-ink disabled:opacity-40"
        >
          Accept
        </button>
        <button
          type="button"
          disabled={!shown}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.commands.acceptSuggestionWord()}
          className={button}
        >
          One word
        </button>
        <button
          type="button"
          disabled={!shown}
          aria-expanded={menu}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMenu((open) => !open)}
          className={button}
        >
          Refine
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.commands.dismissSuggestion()}
          className={button}
        >
          Dismiss
        </button>
        {menu ? (
          <div
            role="menu"
            className="absolute bottom-full left-0 mb-2 w-64 rounded-md border border-line bg-surface p-2 shadow-lg"
          >
            {REFINE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => ask(preset.instruction)}
                className="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-sunk"
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setMenu(false);
                editor.commands.dismissSuggestion();
                void onRefine().then((instruction) => {
                  if (instruction && !editor.isDestroyed) {
                    editor.commands.requestSuggestion(instruction);
                  }
                });
              }}
              className="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-sunk"
            >
              Your own instruction…
            </button>
            <p className="mt-1 px-2 text-[11px] text-muted">
              Each refined suggestion uses one of your Assist suggestions.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
