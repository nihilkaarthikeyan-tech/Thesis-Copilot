/**
 * Live co-authoring rooms — ADR-0028.
 *
 * One room per chapter, for as long as anyone has it open live. The room holds a `Y.Doc` mirror
 * of the chapter, relays every change to everyone else in the room, and writes the chapter back
 * through `ChaptersService.save` — the same path autosave takes, so word counts, citations,
 * snapshots and the style threshold all happen as they always have.
 *
 * The wire protocol is y-websocket's, which is what the browser's `WebsocketProvider` speaks:
 * one varint message type, then a `y-protocols` sync or awareness message. It is about sixty
 * lines to serve, which is why there is no framework in between.
 *
 * ## The database is the truth, the room is a mirror
 *
 * A room loads the chapter's JSON and its `version` when the first person joins and stores with
 * that version as `baseVersion`. If the chapter moved underneath — a restore, an accepted
 * revision — the store gets the conflict autosave would get, the room closes with 4409 and every
 * client reloads onto the fresh text. Nothing merges two histories; nothing guesses.
 *
 * Close codes are in y-websocket's permanent range (4400–4499), so a refused client does not
 * reconnect in a loop: 4401 no session, 4403 not allowed, 4404 no such chapter or feature off,
 * 4409 changed elsewhere.
 */

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { thesisExtensions } from '@tc/ui';
import { getSchema } from '@tiptap/core';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { type WebSocket, WebSocketServer } from 'ws';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import type * as Y from 'yjs';
import { ConflictError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import type { Auth } from '../auth/auth.js';
import { AUTH } from '../auth/auth.tokens.js';
import { ChaptersService } from '../chapters/chapters.service.js';
import { FlagsService } from '../flags/flags.service.js';

/** y-websocket message types. */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/** TipTap's Collaboration extension reads this fragment unless told otherwise. */
const FRAGMENT = 'default';

export const COLLAB_PATH = '/collab/';
export const CLOSE = {
  unauthenticated: 4401,
  forbidden: 4403,
  notFound: 4404,
  changedElsewhere: 4409,
  failed: 4500,
} as const;

/** A second after the last keystroke, and never more than five seconds after the first. */
const STORE_DEBOUNCE_MS = 1_000;
const STORE_MAX_WAIT_MS = 5_000;
const PING_MS = 30_000;

type Room = {
  chapterId: string;
  ownerId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  /** Each socket and the awareness client ids it controls, to clear when it goes. */
  conns: Map<WebSocket, Set<number>>;
  version: number;
  dirty: boolean;
  debounce: NodeJS.Timeout | null;
  firstChangeAt: number | null;
  storing: Promise<void> | null;
  closing: boolean;
};

type Member = { id: string; email: string };

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

@Injectable()
export class CollabService implements OnModuleDestroy {
  private readonly logger = new Logger(CollabService.name);
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly rooms = new Map<string, Room>();
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private readonly pinger: NodeJS.Timeout;
  /** The editor's schema, for turning stored JSON into a `Y.Doc`. Built once. */
  private readonly schema = getSchema(
    thesisExtensions({
      ghostText: {
        chapterId: 'server',
        request: () => {
          throw new Error('Ghost text does not run on the server');
        },
      },
      resizableTables: false,
    }),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly chapters: ChaptersService,
    private readonly flags: FlagsService,
    @Inject(AUTH) private readonly auth: Auth,
  ) {
    this.pinger = setInterval(() => this.ping(), PING_MS);
    this.pinger.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.pinger);
    await Promise.all([...this.rooms.values()].map((room) => this.closeRoom(room, 1001)));
  }

  /** How many people have this chapter open live — for tests and the health page. */
  membersOf(chapterId: string): number {
    return this.rooms.get(chapterId)?.conns.size ?? 0;
  }

  /**
   * The HTTP server's `upgrade` event. Anything not under `/collab/` is not ours and is refused
   * at the socket, before any WebSocket handshake.
   */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const chapterId = chapterIdOf(request.url ?? '');
    if (!chapterId) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      void this.connect(ws, request, chapterId);
    });
  }

  private async connect(ws: WebSocket, request: IncomingMessage, chapterId: string) {
    // Messages can arrive while the session is being looked up; they wait for the room.
    const queued: Buffer[] = [];
    let room: Room | null = null;
    ws.on('message', (data) => {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (room) this.receive(room, ws, bytes);
      else queued.push(bytes);
    });
    this.alive.set(ws, true);
    ws.on('pong', () => this.alive.set(ws, true));

    try {
      if (!(await this.flags.isEnabled('collaboration'))) {
        ws.close(CLOSE.notFound, 'Live editing is not enabled');
        return;
      }
      const member = await this.memberOf(request);
      if (!member) {
        ws.close(CLOSE.unauthenticated, 'Sign in first');
        return;
      }
      const ownerId = await this.ownerIfAllowed(chapterId, member);
      if (ownerId === null) {
        ws.close(CLOSE.forbidden, 'Not shared with you for editing');
        return;
      }
      room = await this.roomFor(chapterId, ownerId);
      if (!room) {
        ws.close(CLOSE.notFound, 'That chapter');
        return;
      }
    } catch (error) {
      this.logger.error({ err: error, chapterId }, 'collab connection failed');
      ws.close(CLOSE.failed, 'Could not open the chapter');
      return;
    }

    const joined = room;
    joined.conns.set(ws, new Set());
    ws.on('close', () => void this.leave(joined, ws));
    ws.on('error', () => void this.leave(joined, ws));

    // Sync step 1, then everyone's presence, then whatever arrived while we were checking.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, joined.doc);
    send(ws, encoding.toUint8Array(encoder));
    const states = joined.awareness.getStates();
    if (states.size > 0) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        aw,
        awarenessProtocol.encodeAwarenessUpdate(joined.awareness, [...states.keys()]),
      );
      send(ws, encoding.toUint8Array(aw));
    }
    for (const bytes of queued) this.receive(joined, ws, bytes);
    this.logger.log({ chapterId, members: joined.conns.size }, 'collab joined');
  }

  private receive(room: Room, ws: WebSocket, bytes: Uint8Array): void {
    try {
      const decoder = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
        // Step 1 wants an answer; an update or step 2 leaves only the type byte.
        if (encoding.length(encoder) > 1) send(ws, encoding.toUint8Array(encoder));
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          room.awareness,
          decoding.readVarUint8Array(decoder),
          ws,
        );
      }
    } catch (error) {
      this.logger.warn({ err: error, chapterId: room.chapterId }, 'collab message dropped');
    }
  }

  private async roomFor(chapterId: string, ownerId: string): Promise<Room | null> {
    const existing = this.rooms.get(chapterId);
    if (existing && !existing.closing) return existing;

    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { content: true, version: true },
    });
    if (!chapter) return null;
    // Another join may have built the room while this one was reading.
    const raced = this.rooms.get(chapterId);
    if (raced && !raced.closing) return raced;

    const content = looksLikeDoc(chapter.content) ? chapter.content : EMPTY_DOC;
    const doc = prosemirrorJSONToYDoc(this.schema, content, FRAGMENT);
    const awareness = new awarenessProtocol.Awareness(doc);
    // The server has no presence of its own.
    awareness.setLocalState(null);
    const room: Room = {
      chapterId,
      ownerId,
      doc,
      awareness,
      conns: new Map(),
      version: chapter.version,
      dirty: false,
      debounce: null,
      firstChangeAt: null,
      storing: null,
      closing: false,
    };

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(room, encoding.toUint8Array(encoder), origin);
      this.scheduleStore(room);
    });
    awareness.on(
      'update',
      (
        { added, updated, removed }: Record<'added' | 'updated' | 'removed', number[]>,
        origin: unknown,
      ) => {
        const changed = [...added, ...updated, ...removed];
        if (origin instanceof Object && room.conns.has(origin as WebSocket)) {
          const controlled = room.conns.get(origin as WebSocket) as Set<number>;
          for (const id of added) controlled.add(id);
          for (const id of removed) controlled.delete(id);
        }
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
        );
        this.broadcast(room, encoding.toUint8Array(encoder), null);
      },
    );

    this.rooms.set(chapterId, room);
    this.logger.log({ chapterId, version: chapter.version }, 'collab room opened');
    return room;
  }

  private broadcast(room: Room, bytes: Uint8Array, except: unknown): void {
    for (const ws of room.conns.keys()) {
      if (ws !== except) send(ws, bytes);
    }
  }

  private scheduleStore(room: Room): void {
    room.dirty = true;
    const now = Date.now();
    room.firstChangeAt ??= now;
    if (room.debounce) clearTimeout(room.debounce);
    const waited = now - room.firstChangeAt;
    const delay = Math.max(0, Math.min(STORE_DEBOUNCE_MS, STORE_MAX_WAIT_MS - waited));
    room.debounce = setTimeout(() => void this.store(room), delay);
  }

  /** Writes the room's document back, one store at a time. */
  private store(room: Room): Promise<void> {
    if (room.storing) return room.storing.then(() => (room.dirty ? this.store(room) : undefined));
    if (!room.dirty || room.closing) return Promise.resolve();
    room.dirty = false;
    room.firstChangeAt = null;
    if (room.debounce) {
      clearTimeout(room.debounce);
      room.debounce = null;
    }
    const content = yDocToProsemirrorJSON(room.doc, FRAGMENT);
    room.storing = this.chapters
      .save(room.ownerId, room.chapterId, content, room.version)
      .then((result) => {
        room.version = result.version;
      })
      .catch(async (error: unknown) => {
        if (error instanceof ConflictError) {
          this.logger.warn({ chapterId: room.chapterId }, 'chapter changed elsewhere; room closes');
          await this.closeRoom(room, CLOSE.changedElsewhere, 'The chapter changed elsewhere');
          return;
        }
        // Kept dirty: the next change, or the last person leaving, tries again.
        room.dirty = true;
        this.logger.error({ err: error, chapterId: room.chapterId }, 'collab store failed');
      })
      .finally(() => {
        room.storing = null;
      });
    return room.storing;
  }

  private async leave(room: Room, ws: WebSocket): Promise<void> {
    const controlled = room.conns.get(ws);
    if (!controlled) return;
    room.conns.delete(ws);
    if (controlled.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, [...controlled], null);
    }
    if (room.conns.size === 0 && !room.closing) {
      // The last person out writes what is there and turns the light off.
      await this.store(room);
      if (room.conns.size === 0) this.dropRoom(room);
    }
  }

  private async closeRoom(room: Room, code: number, reason = ''): Promise<void> {
    room.closing = true;
    for (const ws of room.conns.keys()) ws.close(code, reason);
    this.dropRoom(room);
  }

  private dropRoom(room: Room): void {
    if (room.debounce) clearTimeout(room.debounce);
    room.closing = true;
    this.rooms.delete(room.chapterId);
    room.awareness.destroy();
    room.doc.destroy();
    this.logger.log({ chapterId: room.chapterId }, 'collab room closed');
  }

  private ping(): void {
    for (const room of this.rooms.values()) {
      for (const ws of room.conns.keys()) {
        if (this.alive.get(ws) === false) {
          ws.terminate();
          continue;
        }
        this.alive.set(ws, false);
        ws.ping();
      }
    }
  }

  /** The signed-in person behind the socket, from the same cookie the HTTP guard reads. */
  private async memberOf(request: IncomingMessage): Promise<Member | null> {
    const cookie = request.headers.cookie;
    if (!cookie) return null;
    const session = await this.auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!session?.user) return null;
    return { id: session.user.id, email: session.user.email };
  }

  /**
   * The document's owner id when `member` may edit this chapter live: the owner, or someone
   * whose share says `canEdit`. Null otherwise — and for a chapter that does not exist, so the
   * answer never says which.
   */
  private async ownerIfAllowed(chapterId: string, member: Member): Promise<string | null> {
    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { documentId: true, document: { select: { ownerId: true } } },
    });
    if (!chapter) return null;
    if (chapter.document.ownerId === member.id) return chapter.document.ownerId;
    const share = await this.prisma.guideShare.findFirst({
      where: {
        documentId: chapter.documentId,
        canEdit: true,
        OR: [{ guideUserId: member.id }, { guideEmail: member.email.toLowerCase() }],
      },
      select: { id: true },
    });
    return share ? chapter.document.ownerId : null;
  }
}

/** `/collab/<uuid>` → the chapter id; anything else is not ours. */
export function chapterIdOf(url: string): string | null {
  const path = url.split('?')[0] ?? '';
  if (!path.startsWith(COLLAB_PATH)) return null;
  const id = path.slice(COLLAB_PATH.length).replace(/\/$/, '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

function looksLikeDoc(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'doc' &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

function send(ws: WebSocket, bytes: Uint8Array): void {
  if (ws.readyState === ws.OPEN) ws.send(bytes, { binary: true });
}
