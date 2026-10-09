import { Extension } from '@tiptap/core';

/**
 * ADR-0118, QA 2026-10-09: undo right after a Markdown shortcut gives back the characters typed.
 *
 * TipTap restores them only on Backspace (`undoInputRule` in its core keymap). Ctrl+Z went to
 * the history instead, whose last step is the typing *and* the rule together, so the formatting
 * and the words both vanished. Ctrl+Z now tries `undoInputRule` first. That command only does
 * anything in the transaction straight after a rule fired — any other edit or a caret move clears
 * it — so everywhere else Ctrl+Z falls through to the ordinary undo (history, or Yjs live).
 */
export const UndoInputRule = Extension.create({
  name: 'undoInputRule',
  // Above StarterKit's history (100), so this runs before its Mod-z.
  priority: 200,
  addKeyboardShortcuts() {
    return {
      'Mod-z': () => this.editor.commands.undoInputRule(),
    };
  },
});
