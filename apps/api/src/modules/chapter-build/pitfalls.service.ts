/**
 * The pitfall bank — ADR-0039, spec §8. Known technical errors the checks and the examiner look
 * for. Entries from the specification's evaluation are seeded APPROVED; a student's or
 * supervisor's report is PENDING until a superadmin approves it (§8.2 governance). Every admin
 * change is written to the activity log.
 */

import { Injectable } from '@nestjs/common';
import { DISCIPLINE_PROFILES } from '@tc/config';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';

export const pitfallBody = z.object({
  profile: z.string().trim().min(1).max(60),
  topic: z.string().trim().min(2).max(80),
  wrongPattern: z.string().trim().min(5).max(500),
  pattern: z.string().trim().max(500).optional().nullable(),
  detection: z.enum(['regex', 'semantic', 'both']).optional(),
  correctStatement: z.string().trim().min(5).max(1000),
  severity: z.enum(['blocking', 'warning']).optional(),
  source: z.string().trim().max(300).optional().nullable(),
});
export type PitfallBody = z.infer<typeof pitfallBody>;

export const reportBody = z.object({
  topic: z.string().trim().min(2).max(80),
  wrongPattern: z.string().trim().min(5).max(500),
  correctStatement: z.string().trim().min(5).max(1000),
  source: z.string().trim().max(300).optional(),
});

export type PitfallView = {
  id: string;
  code: string;
  profile: string;
  profileName: string;
  topic: string;
  wrongPattern: string;
  pattern: string | null;
  detection: string;
  correctStatement: string;
  severity: string;
  source: string | null;
  status: string;
  approvedBy: string | null;
  reportedById: string | null;
  version: number;
  hits: number;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class PitfallsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Approved entries for one discipline, for the student's own view of what is checked. */
  async forProfile(profile: string): Promise<PitfallView[]> {
    const rows = await this.prisma.pitfall.findMany({
      where: { status: 'APPROVED', profile: { in: [profile, '*'] } },
      orderBy: [{ topic: 'asc' }, { code: 'asc' }],
    });
    return rows.map(view);
  }

  /** A student's or supervisor's report goes into the queue as PENDING (§8.2). */
  async report(userId: string, profile: string, body: unknown): Promise<PitfallView> {
    const parsed = reportBody.safeParse(body);
    if (!parsed.success)
      throw new ValidationError('Say what is wrong and what is right.', parsed.error.issues);
    const code = await this.nextCode(profile, 'RPT');
    const row = await this.prisma.pitfall.create({
      data: {
        code,
        profile,
        topic: parsed.data.topic,
        wrongPattern: parsed.data.wrongPattern,
        detection: 'semantic',
        correctStatement: parsed.data.correctStatement,
        severity: 'warning',
        source: parsed.data.source ?? null,
        status: 'PENDING',
        reportedById: userId,
      },
    });
    return view(row);
  }

  // ---- Admin -------------------------------------------------------------------------------

  async list(status: 'PENDING' | 'APPROVED' | 'RETIRED' | 'ALL'): Promise<PitfallView[]> {
    const rows = await this.prisma.pitfall.findMany({
      where: status === 'ALL' ? {} : { status },
      orderBy: [{ status: 'asc' }, { profile: 'asc' }, { code: 'asc' }],
    });
    return rows.map(view);
  }

  async create(actorId: string, body: unknown): Promise<PitfallView> {
    const parsed = pitfallBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Fill in the entry.', parsed.error.issues);
    assertPattern(parsed.data.pattern ?? null);
    const code = await this.nextCode(parsed.data.profile, 'ADM');
    const row = await this.prisma.pitfall.create({
      data: {
        code,
        profile: parsed.data.profile,
        topic: parsed.data.topic,
        wrongPattern: parsed.data.wrongPattern,
        pattern: parsed.data.pattern ?? null,
        detection: parsed.data.detection ?? (parsed.data.pattern ? 'both' : 'semantic'),
        correctStatement: parsed.data.correctStatement,
        severity: parsed.data.severity ?? 'blocking',
        source: parsed.data.source ?? null,
        status: 'APPROVED',
        approvedBy: actorId,
      },
    });
    await this.audit(actorId, 'PITFALL_APPROVED', row.id, row.code);
    return view(row);
  }

  async update(actorId: string, id: string, body: unknown): Promise<PitfallView> {
    const parsed = pitfallBody.partial().safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid entry.', parsed.error.issues);
    if (parsed.data.pattern !== undefined) assertPattern(parsed.data.pattern ?? null);
    const existing = await this.prisma.pitfall.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('That pitfall');
    const row = await this.prisma.pitfall.update({
      where: { id },
      data: { ...parsed.data, version: { increment: 1 } },
    });
    await this.audit(actorId, 'PITFALL_EDITED', row.id, row.code);
    return view(row);
  }

  async setStatus(
    actorId: string,
    id: string,
    status: 'APPROVED' | 'RETIRED' | 'PENDING',
  ): Promise<PitfallView> {
    const existing = await this.prisma.pitfall.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('That pitfall');
    const row = await this.prisma.pitfall.update({
      where: { id },
      data: { status, ...(status === 'APPROVED' ? { approvedBy: actorId } : {}) },
    });
    await this.audit(
      actorId,
      status === 'APPROVED'
        ? 'PITFALL_APPROVED'
        : status === 'RETIRED'
          ? 'PITFALL_RETIRED'
          : 'PITFALL_EDITED',
      row.id,
      row.code,
    );
    return view(row);
  }

  async pendingCount(): Promise<number> {
    return this.prisma.pitfall.count({ where: { status: 'PENDING' } });
  }

  private async audit(
    actorId: string,
    kind: string,
    pitfallId: string,
    code: string,
  ): Promise<void> {
    // The bank has no subject user; the admin is both the actor and the row's user.
    await this.prisma.auditEvent.create({
      data: { kind, userId: actorId, actorId, detail: { pitfallId, code } },
    });
  }

  /** `ENG-RPT-007`: the discipline's prefix, who added it, a running number. */
  private async nextCode(profile: string, origin: 'RPT' | 'ADM'): Promise<string> {
    const prefix = profile === '*' ? 'ALL' : profile.slice(0, 3).toUpperCase();
    const count = await this.prisma.pitfall.count({
      where: { code: { startsWith: `${prefix}-${origin}-` } },
    });
    return `${prefix}-${origin}-${String(count + 1).padStart(3, '0')}`;
  }
}

function assertPattern(pattern: string | null): void {
  if (!pattern) return;
  try {
    new RegExp(pattern, 'i');
  } catch {
    throw new ValidationError('The pattern is not a valid regular expression.');
  }
}

function view(row: {
  id: string;
  code: string;
  profile: string;
  topic: string;
  wrongPattern: string;
  pattern: string | null;
  detection: string;
  correctStatement: string;
  severity: string;
  source: string | null;
  status: string;
  approvedBy: string | null;
  reportedById: string | null;
  version: number;
  hits: number;
  createdAt: Date;
  updatedAt: Date;
}): PitfallView {
  return {
    ...row,
    profileName:
      row.profile === '*'
        ? 'Every discipline'
        : (DISCIPLINE_PROFILES.find((d) => d.id === row.profile)?.displayName ?? row.profile),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
