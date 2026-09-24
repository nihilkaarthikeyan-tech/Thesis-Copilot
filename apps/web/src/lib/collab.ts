/**
 * The browser's side of live co-authoring — ADR-0028.
 *
 * Two halves, on purpose. `createLiveDoc` makes the inert values the editor is built on — a
 * `Y.Doc`, its awareness, the person's name and colour — and can be called from a state
 * initialiser (React calls those twice in development and keeps one; a spare doc is nothing).
 * `connectLive` opens the socket and belongs in an effect, whose cleanup destroys it; the effect
 * running twice in development then opens and closes one socket, not two.
 *
 * The socket carries the session cookie on its own: it is same-site with the API, so the browser
 * attaches it as it does to every request. Nothing here decides who may join — the server does,
 * and answers with a close code in the permanent range when the answer is no.
 */

import { Awareness } from 'y-protocols/awareness';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { API_URL } from './api';

/** `ws(s)://…/collab`, next to the API unless told otherwise (production has its own path). */
export const COLLAB_URL =
  process.env.NEXT_PUBLIC_COLLAB_URL ?? `${API_URL.replace(/^http/, 'ws')}/collab`;

/** The server's close codes (`CLOSE` in `collab.service.ts`). */
export const COLLAB_CLOSE = {
  unauthenticated: 4401,
  forbidden: 4403,
  notFound: 4404,
  changedElsewhere: 4409,
} as const;

/** Eight colours that read on white and tell people apart; chosen by the name, so it is stable. */
const COLOURS = [
  '#1f4e79',
  '#c55a11',
  '#548235',
  '#7030a0',
  '#bf9000',
  '#2e75b6',
  '#b03060',
  '#2f6f6f',
];

export function colourFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return COLOURS[Math.abs(hash) % COLOURS.length] ?? '#1f4e79';
}

/** "priya" from priya@example.edu — the part a co-author recognises. */
export function displayNameOf(email: string): string {
  return email.split('@')[0] ?? email;
}

export type LiveDoc = {
  doc: Y.Doc;
  awareness: Awareness;
  user: { name: string; color: string };
};

export function createLiveDoc(email: string): LiveDoc {
  const doc = new Y.Doc();
  const name = displayNameOf(email);
  return { doc, awareness: new Awareness(doc), user: { name, color: colourFor(name) } };
}

/** Names on everyone else's cursor, from the awareness states. */
export function othersIn(live: LiveDoc): string[] {
  const names: string[] = [];
  live.awareness.getStates().forEach((state, clientId) => {
    const user = (state as { user?: { name?: string } }).user;
    if (clientId !== live.doc.clientID && user?.name) names.push(user.name);
  });
  return [...new Set(names)];
}

export function connectLive(chapterId: string, live: LiveDoc): WebsocketProvider {
  return new WebsocketProvider(COLLAB_URL, chapterId, live.doc, {
    awareness: live.awareness,
    // Tabs of one browser would otherwise sync through a BroadcastChannel and skip the server,
    // which is fine for text and wrong for presence: the server never learns the second tab.
    disableBc: true,
  });
}
