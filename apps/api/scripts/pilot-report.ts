/**
 * `pnpm pilot:report` — PRD §15, PHASES 5.10.
 *
 *   "per student — words written by provenance, Assist acceptance rate, Draft accept/discard,
 *    p50/p95 TTFB, cost for the period; platform totals; hallucinated-cite count; cap-exceeded
 *    events."
 *
 * Numbers only, read from the tables that record what happened (`Chapter.content` for words by
 * provenance, `SuggestionEvent`, `AiCallLog`, `AuditEvent`). The interpretation is the human's,
 * in `docs/PILOT-1.md`. Usage:
 *
 *   pnpm pilot:report                 # the current calendar month (UTC), the cap period
 *   pnpm pilot:report 2026-09         # a given period
 *   pnpm pilot:report --json          # machine-readable
 */

import { PrismaClient } from '@tc/db';

type ProvenanceKind = 'HUMAN' | 'ASSIST' | 'DRAFT' | 'COMMAND' | 'HUMAN_EDITED';
const KINDS: ProvenanceKind[] = ['HUMAN', 'ASSIST', 'DRAFT', 'COMMAND', 'HUMAN_EDITED'];

type Node = {
  type?: string;
  text?: string;
  marks?: Array<{ type: string; attrs?: { kind?: string } }>;
  content?: Node[];
};

/** Words per provenance kind in one ProseMirror document. Unmarked text counts as HUMAN (B.4). */
export function wordsByProvenance(doc: unknown): Record<ProvenanceKind, number> {
  const out = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<ProvenanceKind, number>;
  const walk = (node: Node | undefined): void => {
    if (!node) return;
    if (node.type === 'text' && node.text) {
      const mark = node.marks?.find((m) => m.type === 'provenance');
      const kind = (mark?.attrs?.kind ?? 'HUMAN') as ProvenanceKind;
      const words = node.text.trim().split(/\s+/).filter(Boolean).length;
      out[KINDS.includes(kind) ? kind : 'HUMAN'] += words;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc as Node);
  return out;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

const toInr = (microInr: bigint | number): number => Math.round(Number(microInr) / 10_000) / 100;

function periodBounds(period: string): { from: Date; to: Date } {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) throw new Error(`period must be YYYY-MM, got ${period}`);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

export type StudentReport = {
  email: string;
  plan: string;
  documents: number;
  words: Record<ProvenanceKind, number>;
  assist: { shown: number; accepted: number; partial: number; rate: number | null };
  draft: { accepted: number; discarded: number };
  ttfbMs: { p50: number | null; p95: number | null };
  costInr: number;
  capExceeded: number;
};

export type PilotReport = {
  period: string;
  students: StudentReport[];
  platform: {
    students: number;
    words: Record<ProvenanceKind, number>;
    costInr: number;
    calls: number;
    failedCalls: number;
    hallucinatedCites: number;
    capExceeded: number;
    ttfbMs: { p50: number | null; p95: number | null };
  };
};

export async function buildReport(prisma: PrismaClient, period: string): Promise<PilotReport> {
  const { from, to } = periodBounds(period);
  const window = { gte: from, lt: to };

  const users = await prisma.user.findMany({
    where: { role: 'STUDENT' },
    select: {
      id: true,
      email: true,
      plan: true,
      documents: { select: { id: true, chapters: { select: { content: true } } } },
    },
    orderBy: { email: 'asc' },
  });

  const [events, calls, capEvents] = await Promise.all([
    prisma.suggestionEvent.findMany({
      where: { createdAt: window },
      select: { userId: true, action: true, outcome: true, ttfbMs: true },
    }),
    prisma.aiCallLog.findMany({
      where: { createdAt: window },
      select: { userId: true, costMicroInr: true, ok: true, error: true },
    }),
    prisma.auditEvent.findMany({
      where: { kind: 'CAP_EXCEEDED', createdAt: window },
      select: { userId: true },
    }),
  ]);

  const students: StudentReport[] = users.map((u) => {
    const words = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<ProvenanceKind, number>;
    for (const d of u.documents) {
      for (const c of d.chapters) {
        const w = wordsByProvenance(c.content);
        for (const k of KINDS) words[k] += w[k];
      }
    }
    const mine = events.filter((e) => e.userId === u.id);
    // One row per suggestion, its outcome updated in place (FR-9.4), so "shown" is every row,
    // the same reading the admin dashboard gives.
    const assistEvents = mine.filter((e) => e.action === 'ASSIST');
    const shown = assistEvents.length;
    const accepted = assistEvents.filter((e) => e.outcome === 'ACCEPTED').length;
    const partial = assistEvents.filter((e) => e.outcome === 'PARTIAL').length;
    const draftEvents = mine.filter((e) => e.action === 'DRAFT');
    const ttfbs = assistEvents
      .map((e) => e.ttfbMs)
      .filter((v): v is number => typeof v === 'number');
    const myCalls = calls.filter((c) => c.userId === u.id);
    return {
      email: u.email,
      plan: u.plan,
      documents: u.documents.length,
      words,
      assist: {
        shown,
        accepted,
        partial,
        rate: shown === 0 ? null : Math.round(((accepted + partial) / shown) * 1000) / 10,
      },
      draft: {
        accepted: draftEvents.filter((e) => e.outcome === 'ACCEPTED').length,
        discarded: draftEvents.filter((e) => e.outcome === 'DISCARDED').length,
      },
      ttfbMs: { p50: percentile(ttfbs, 50), p95: percentile(ttfbs, 95) },
      costInr: toInr(myCalls.reduce((sum, c) => sum + c.costMicroInr, 0n)),
      capExceeded: capEvents.filter((e) => e.userId === u.id).length,
    };
  });

  const platformWords = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<
    ProvenanceKind,
    number
  >;
  for (const s of students) for (const k of KINDS) platformWords[k] += s.words[k];
  const allTtfb = events
    .filter((e) => e.action === 'ASSIST')
    .map((e) => e.ttfbMs)
    .filter((v): v is number => typeof v === 'number');

  return {
    period,
    students,
    platform: {
      students: students.length,
      words: platformWords,
      costInr: toInr(calls.reduce((sum, c) => sum + c.costMicroInr, 0n)),
      calls: calls.length,
      failedCalls: calls.filter((c) => !c.ok).length,
      hallucinatedCites: calls.filter((c) => c.error?.includes('HALLUCINATED_CITE')).length,
      capExceeded: capEvents.length,
      ttfbMs: { p50: percentile(allTtfb, 50), p95: percentile(allTtfb, 95) },
    },
  };
}

export function renderReport(report: PilotReport): string {
  const ms = (v: number | null) => (v === null ? '–' : `${v} ms`);
  const lines: string[] = [];
  lines.push(`Pilot report — period ${report.period} (UTC)`);
  lines.push('');
  lines.push(
    [
      'student'.padEnd(34),
      'plan'.padEnd(16),
      'docs',
      'human'.padStart(7),
      'assist'.padStart(7),
      'draft'.padStart(7),
      'edited'.padStart(7),
      'acc%'.padStart(6),
      'drft+/-'.padStart(8),
      'p50'.padStart(8),
      'p95'.padStart(8),
      'cost₹'.padStart(8),
      'cap!'.padStart(5),
    ].join(' '),
  );
  for (const s of report.students) {
    lines.push(
      [
        s.email.slice(0, 34).padEnd(34),
        s.plan.padEnd(16),
        String(s.documents).padStart(4),
        String(s.words.HUMAN).padStart(7),
        String(s.words.ASSIST).padStart(7),
        String(s.words.DRAFT).padStart(7),
        String(s.words.HUMAN_EDITED).padStart(7),
        (s.assist.rate === null ? '–' : String(s.assist.rate)).padStart(6),
        `${s.draft.accepted}/${s.draft.discarded}`.padStart(8),
        ms(s.ttfbMs.p50).padStart(8),
        ms(s.ttfbMs.p95).padStart(8),
        s.costInr.toFixed(2).padStart(8),
        String(s.capExceeded).padStart(5),
      ].join(' '),
    );
  }
  const p = report.platform;
  lines.push('');
  lines.push('Platform');
  lines.push(`  students            ${p.students}`);
  lines.push(
    `  words               human ${p.words.HUMAN} · assist ${p.words.ASSIST} · draft ${p.words.DRAFT} · edited ${p.words.HUMAN_EDITED}`,
  );
  lines.push(`  AI calls            ${p.calls} (${p.failedCalls} failed)`);
  lines.push(`  cost                ₹${p.costInr.toFixed(2)}`);
  lines.push(`  hallucinated cites  ${p.hallucinatedCites}`);
  lines.push(`  cap-exceeded        ${p.capExceeded}`);
  lines.push(`  Assist TTFB         p50 ${ms(p.ttfbMs.p50)} · p95 ${ms(p.ttfbMs.p95)}`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const now = new Date();
  const period =
    args.find((a) => /^\d{4}-\d{2}$/.test(a)) ??
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const prisma = new PrismaClient();
  try {
    const report = await buildReport(prisma, period);
    console.log(json ? JSON.stringify(report, null, 2) : renderReport(report));
  } finally {
    await prisma.$disconnect();
  }
}

// Only when run as a script; the test imports the functions.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/pilot-report.ts')) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
