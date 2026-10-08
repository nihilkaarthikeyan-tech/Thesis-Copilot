/**
 * Migration 0045 (ADR-0116): each thesis's one conversation becomes its first chat thread, word
 * for word, and nothing is lost.
 *
 * The harness applies every migration to an empty database, which cannot show what a migration
 * does to rows already there. So this runs the migrations before 0045, writes theses the way the
 * old code stored their chat (`Document.meta.chat.turns`), applies 0045 and reads the result. Real
 * Postgres in Testcontainers, the real migration files, run by psql as `migrate deploy` would.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@tc/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../packages/db/prisma/migrations/', import.meta.url),
);
const THREADS = '0045_chat_threads';
const ALL = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const BEFORE = ALL.filter((name) => name < THREADS);
const AFTER = ALL.filter((name) => name >= THREADS);

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;

async function apply(names: readonly string[]): Promise<void> {
  for (const name of names) {
    await container.copyFilesToContainer([
      { source: join(MIGRATIONS_DIR, name, 'migration.sql'), target: `/tmp/m/${name}.sql` },
    ]);
    const result = await container.exec([
      'psql',
      '-U',
      'tc',
      '-d',
      'tc_test',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      `/tmp/m/${name}.sql`,
    ]);
    if (result.exitCode !== 0) throw new Error(`migration ${name} failed:\n${result.output}`);
  }
}

const ASKED = [
  {
    id: 'q-1',
    role: 'user',
    text: '  What   limits rooftop solar adoption\namong rural households in Karnataka, according to the papers I have added so far?',
  },
  {
    id: 'a-1',
    role: 'assistant',
    text: 'Upfront cost {{cite:S1#c1}}.',
    citations: [{ key: 'S1#c1', sourceId: 's-1', chunkId: 'c-1', label: 'Kumar, 2021' }],
    rating: 1,
  },
  { id: 'q-2', role: 'user', text: 'And credit?' },
  { id: 'a-2', role: 'assistant', text: 'Credit is scarce.', citations: [] },
];

let withChat: string;
let cleared: string;
let never: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('tc_test')
    .withUsername('tc')
    .withPassword('tc')
    .start();
  await apply(BEFORE);
  prisma = new PrismaClient({ datasources: { db: { url: container.getConnectionUri() } } });
  await prisma.$connect();

  const user = await prisma.user.create({
    data: { email: 'threads-migration@example.com', role: 'STUDENT', plan: 'FREE_TRIAL' },
  });
  // Written as the old code wrote them: the chat inside `meta`, beside the thesis's other keys.
  const make = async (title: string, meta: unknown) =>
    (
      await prisma.document.create({
        data: { ownerId: user.id, title, entryPath: 'A_TOPIC', meta: meta as object },
        select: { id: true },
      })
    ).id;
  withChat = await make('With a chat', {
    chat: { turns: ASKED },
    sourcePrefs: { librarySearch: true },
  });
  cleared = await make('Cleared chat', { chat: { turns: [] }, other: 1 });
  never = await make('Never chatted', { other: 2 });

  await apply(AFTER);
}, 300_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

describe('migration 0045', () => {
  it('makes the existing conversation the first thread of its thesis, word for word', async () => {
    const threads = await prisma.chatThread.findMany({ where: { documentId: withChat } });
    expect(threads).toHaveLength(1);
    const thread = threads[0];
    expect(thread?.turns).toEqual(ASKED);
    expect(thread?.questions).toBe(2);
    expect(thread?.collectionId).toBeNull();
    expect(thread?.collectionName).toBeNull();
    // The first question, spaces collapsed, cut to 80.
    expect(thread?.title).toBe(
      'What limits rooftop solar adoption among rural households in Karnataka, accordin',
    );
    expect(thread?.title.length).toBe(80);
    // A UUID v7, from the column default.
    expect(thread?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  });

  it('removes the old key and keeps everything else in meta', async () => {
    const doc = await prisma.document.findUnique({ where: { id: withChat } });
    expect(doc?.meta).toEqual({ sourcePrefs: { librarySearch: true } });
    const empty = await prisma.document.findUnique({ where: { id: cleared } });
    expect(empty?.meta).toEqual({ other: 1 });
    const untouched = await prisma.document.findUnique({ where: { id: never } });
    expect(untouched?.meta).toEqual({ other: 2 });
  });

  it('makes no thread of an empty conversation or of none', async () => {
    expect(await prisma.chatThread.count({ where: { documentId: cleared } })).toBe(0);
    expect(await prisma.chatThread.count({ where: { documentId: never } })).toBe(0);
  });
});
