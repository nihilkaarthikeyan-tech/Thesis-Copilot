/**
 * Chat threads, the panel's side (ADR-0116). The API is `GET /chat/:documentId/threads`,
 * `GET /chat/:documentId?threadId=` and `threadId` / `newThread` / `collectionId` on `POST /chat`
 * (`apps/api/src/modules/assist/chat-threads.service.ts`); the panel is
 * `components/editor/ChatPanel.tsx`.
 *
 * Pure, apart from the two storage calls, so what the panel shows and sends is tested.
 */

export type ThreadCollection = { id: string; name: string };

/** One row of the list of chats, as the API sends it. */
export type ChatThreadSummary = {
  id: string;
  title: string;
  questions: number;
  collection: ThreadCollection | null;
  collectionDeleted: boolean;
  collectionName: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * The chat the panel has open. `id` is null for a new chat, which the server stores (and names)
 * with its first answer; `collection` is what it answers from, if not the whole library.
 */
export type OpenChat = {
  id: string | null;
  title: string;
  collection: ThreadCollection | null;
  /** It answered from a collection that has since been deleted: readable, not askable. */
  collectionDeleted: boolean;
  collectionName: string | null;
};

export const NEW_CHAT: OpenChat = {
  id: null,
  title: '',
  collection: null,
  collectionDeleted: false,
  collectionName: null,
};

/**
 * What the bar above the chat shows (QA 2026-10-08): while the stored chat is still loading, a
 * neutral "Opening chat…" rather than "New chat" (which read for up to ~4 s as if the student's
 * conversation had gone); then the chat's title, or "New chat" for one not stored yet.
 */
export function threadBarState(loading: boolean, title: string): 'loading' | 'new' | 'title' {
  if (loading) return 'loading';
  return title ? 'title' : 'new';
}

/** What a question sends to say which chat it belongs to. */
export function threadFields(
  chat: OpenChat,
): { threadId: string } | { newThread: true; collectionId?: string } {
  if (chat.id) return { threadId: chat.id };
  return chat.collection
    ? { newThread: true, collectionId: chat.collection.id }
    : { newThread: true };
}

/** When a chat was last used, said briefly: "Just now", "12 min ago", "3 h ago", "Yesterday", "2 Oct". */
export function threadWhen(updatedAt: string, now: Date = new Date()): string {
  const at = new Date(updatedAt);
  const ms = now.getTime() - at.getTime();
  if (!Number.isFinite(ms)) return '';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const sameDay = at.toDateString() === now.toDateString();
  if (sameDay) return `${Math.floor(minutes / 60)} h ago`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** The line under a chat's title in the list. */
export function threadLine(thread: ChatThreadSummary, now: Date = new Date()): string {
  const parts = [
    threadWhen(thread.updatedAt, now),
    `${thread.questions} ${thread.questions === 1 ? 'question' : 'questions'}`,
  ];
  if (thread.collection) parts.push(thread.collection.name);
  else if (thread.collectionDeleted && thread.collectionName) {
    parts.push(`${thread.collectionName} (deleted)`);
  }
  return parts.filter(Boolean).join(' · ');
}

/** Which chat was open in this tab, so leaving the Chat tab and coming back keeps it. */
export type RememberedChat =
  | { kind: 'thread'; id: string }
  | { kind: 'new'; collectionId: string | null };

const KEY = (documentId: string) => `tc.chat.open.${documentId}`;

/** Remembers the open chat for this tab. Storage can be refused; that only loses the convenience. */
export function rememberChat(documentId: string, chat: OpenChat): void {
  const value: RememberedChat = chat.id
    ? { kind: 'thread', id: chat.id }
    : { kind: 'new', collectionId: chat.collection?.id ?? null };
  try {
    sessionStorage.setItem(KEY(documentId), JSON.stringify(value));
  } catch {
    // A private window or blocked storage: the panel opens the last chat instead.
  }
}

export function recallChat(documentId: string): RememberedChat | null {
  try {
    const raw = sessionStorage.getItem(KEY(documentId));
    return raw ? parseRemembered(raw) : null;
  } catch {
    return null;
  }
}

export function parseRemembered(raw: string): RememberedChat | null {
  try {
    const value = JSON.parse(raw) as Partial<{ kind: string; id: unknown; collectionId: unknown }>;
    if (value.kind === 'thread' && typeof value.id === 'string' && value.id) {
      return { kind: 'thread', id: value.id };
    }
    if (value.kind === 'new') {
      return {
        kind: 'new',
        collectionId: typeof value.collectionId === 'string' ? value.collectionId : null,
      };
    }
  } catch {
    // Not ours, or damaged: ignored.
  }
  return null;
}

/** The papers a chat on a collection may name with `@`: those filed in it. */
export function inThreadCollection<T extends { collectionIds?: readonly string[] | undefined }>(
  rows: readonly T[],
  collectionId: string | null,
): T[] {
  if (!collectionId) return [...rows];
  return rows.filter((row) => (row.collectionIds ?? []).includes(collectionId));
}
