/**
 * jsdom 27 has no ClipboardEvent; ProseMirror's `view.pasteHTML` / `pasteText` construct one.
 */
if (typeof globalThis.ClipboardEvent === 'undefined') {
  class ClipboardEventPolyfill extends Event {
    clipboardData: DataTransfer | null;
    constructor(type: string, init: EventInit & { clipboardData?: DataTransfer | null } = {}) {
      super(type, init);
      this.clipboardData = init.clipboardData ?? null;
    }
  }
  (globalThis as unknown as { ClipboardEvent: unknown }).ClipboardEvent = ClipboardEventPolyfill;
}
