/**
 * The keys and the Markdown the editor understands, as the student is shown them — R35,
 * ADR-0118.
 *
 * One list, read by the "Keyboard shortcuts" window in the app and by the test that types every
 * Markdown entry into a real editor, so the window can never promise a rule the editor does not
 * have. Every key here was checked in the extension that binds it (`@tiptap/extension-*` 2.27.3,
 * and our own `ghost-text.ts`, `move-block.ts`, `nodes.ts`).
 */

export type KeyShortcut = {
  /** Keys as written on Windows and Linux; `Ctrl` is `⌘` on a Mac (`macKeys`). */
  keys: string;
  does: string;
};

export type ShortcutGroup = { title: string; shortcuts: readonly KeyShortcut[] };

export const KEY_SHORTCUTS: readonly ShortcutGroup[] = [
  {
    title: 'Suggestions',
    shortcuts: [
      { keys: 'Ctrl+/', does: 'Ask for a suggestion at the cursor' },
      { keys: 'Tab', does: 'Accept the suggestion' },
      { keys: 'Alt+→', does: 'Accept one word of it' },
      { keys: 'Shift+→', does: 'Guide it: say what the next sentence should do' },
      { keys: 'Esc', does: 'Dismiss it' },
      { keys: 'Ctrl+Shift+D', does: 'Draft a whole section from your library' },
    ],
  },
  {
    title: 'Writing',
    shortcuts: [
      { keys: '@', does: 'Cite a source from your library' },
      { keys: '/', does: 'Insert a block: a table, a figure, an equation…' },
      { keys: 'Ctrl+B', does: 'Bold' },
      { keys: 'Ctrl+I', does: 'Italic' },
      { keys: 'Ctrl+U', does: 'Underline' },
      { keys: 'Ctrl+Shift+S', does: 'Strikethrough' },
      { keys: 'Ctrl+E', does: 'Code' },
      { keys: 'Ctrl+.', does: 'Superscript' },
      { keys: 'Ctrl+,', does: 'Subscript' },
      { keys: 'Ctrl+Alt+2', does: 'Section heading' },
      { keys: 'Ctrl+Alt+3', does: 'Subheading' },
      { keys: 'Ctrl+Shift+8', does: 'Bulleted list' },
      { keys: 'Ctrl+Shift+7', does: 'Numbered list' },
      { keys: 'Ctrl+Shift+B', does: 'Quotation' },
      { keys: 'Ctrl+Alt+C', does: 'Code block' },
    ],
  },
  {
    title: 'The chapter',
    shortcuts: [
      { keys: 'Ctrl+Shift+↑', does: 'Move the block up' },
      { keys: 'Ctrl+Shift+↓', does: 'Move the block down' },
      { keys: 'Ctrl+Z', does: 'Undo' },
      { keys: 'Ctrl+Shift+Z', does: 'Redo (also Ctrl+Y)' },
      { keys: 'Ctrl+S', does: 'Save a snapshot in the version history' },
    ],
  },
];

export type MarkdownShortcut = {
  /** What to type, exactly; `␣` is a space. */
  typed: string;
  /** What it becomes. */
  gives: string;
  /** For the test: the characters that trigger it, typed into an empty paragraph. */
  sample: string;
  /** For the test: what the paragraph becomes (a node type, or a mark on the text). */
  expect: { node: string } | { mark: string; text: string } | { inline: string };
};

export const MARKDOWN_SHORTCUTS: readonly MarkdownShortcut[] = [
  { typed: '## ', gives: 'Section heading', sample: '## ', expect: { node: 'heading' } },
  { typed: '### ', gives: 'Subheading', sample: '### ', expect: { node: 'heading' } },
  {
    typed: '- ',
    gives: 'Bulleted list (also * or +)',
    sample: '- ',
    expect: { node: 'bulletList' },
  },
  { typed: '1. ', gives: 'Numbered list', sample: '1. ', expect: { node: 'orderedList' } },
  { typed: '> ', gives: 'Quotation', sample: '> ', expect: { node: 'blockquote' } },
  { typed: '``` ', gives: 'Code block', sample: '``` ', expect: { node: 'codeBlock' } },
  { typed: '---', gives: 'Horizontal line', sample: '---', expect: { node: 'horizontalRule' } },
  {
    typed: '**bold**',
    gives: 'Bold (also __bold__)',
    sample: '**bold**',
    expect: { mark: 'bold', text: 'bold' },
  },
  {
    typed: '*italic*',
    gives: 'Italic (also _italic_)',
    sample: '*italic*',
    expect: { mark: 'italic', text: 'italic' },
  },
  {
    typed: '~~struck~~',
    gives: 'Strikethrough',
    sample: '~~struck~~',
    expect: { mark: 'strike', text: 'struck' },
  },
  { typed: '`code`', gives: 'Code', sample: '`code`', expect: { mark: 'code', text: 'code' } },
  {
    typed: '$$x^2$$',
    gives: 'Equation, in LaTeX (on a line of its own: a displayed equation)',
    sample: 'Area is $$\\pi r^2$$',
    expect: { inline: 'mathInline' },
  },
];

/** The same keys as a Mac shows them. */
export function macKeys(keys: string): string {
  return keys.replace(/Ctrl\+/g, '⌘+').replace(/Alt\+/g, '⌥+');
}
