/**
 * Institution admin — PRD FR-9.6, §8 `Institution`, §11.3 `INSTITUTION_SEAT`, PHASES v2 B4.1.
 *
 *   "create institution, invite students, seat count, usage by student, invoice PDF"
 *
 * Two decisions run through the whole file.
 *
 * **A pending invite holds a seat** (ADR-0009). Counting `Institution.users` counts accounts that
 * exist; an invite goes to an address that has none. Without holding the seat, an institution with
 * thirty seats could invite three hundred people and find out at the thirty-first acceptance —
 * which is the point at which someone is already using a capped plan nobody paid for.
 *
 * **The admin sees usage, never content** (§12.2). A department paying for seats has a real
 * interest in whether they are used, and none at all in what a student wrote. This service
 * returns counts, costs and last-active dates. It does not select a title, a chapter, or a word of
 * anyone's thesis.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { type AiAction, type Env, METERED_ACTIONS, PLAN_LIMITS, type Plan } from '@tc/config';
import { invoiceToDocx } from '@tc/export';
import { ENV } from '../../common/env.token.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { StorageService } from '../../common/storage.service.js';
import type { SessionUser } from '../auth/current-user.decorator.js';
import { periodFor } from '../usage/usage.service.js';
import { claimInstitutionInvite } from './claim-invite.js';

/** How long an unaccepted invite holds its seat. Long enough for a semester's paperwork. */
const INVITE_DAYS = 30;

const toInr = (microInr: bigint | number): number => Math.round(Number(microInr) / 10_000) / 100;

export type SeatCount = {
  total: number;
  members: number;
  pendingInvites: number;
  used: number;
  free: number;
};

export type InstitutionView = {
  id: string;
  name: string;
  seats: SeatCount;
  seatPriceInr: number;
  billingPeriod: string;
  billingEmail: string | null;
  /** The formatting template every new thesis in this institution starts on (D.3.1). */
  template: { id: string; name: string } | null;
  templates: Array<{ id: string; name: string; isExample: boolean }>;
  createdAt: Date;
};

export type InviteRow = {
  id: string;
  email: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  invitedAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
};

export type StudentUsageRow = {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  joinedAt: Date;
  lastActiveAt: Date | null;
  /** How many theses, not what is in them (§12.2). */
  documents: number;
  costInr: number;
  usage: Array<{ action: AiAction; used: number; cap: number }>;
};

export type InstitutionInvoice = {
  period: string;
  number: string;
  seats: number;
  seatPriceInr: number;
  totalInr: number;
  billedTo: string;
};

@Injectable()
export class InstitutionService {
  private readonly logger = new Logger(InstitutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** SUPERADMIN: a new institution and its first admin. */
  async create(
    actorId: string,
    input: {
      name: string;
      seats: number;
      adminEmail: string;
      seatPriceInr: number;
      billingPeriod: 'monthly' | 'yearly';
      billingEmail?: string;
    },
  ): Promise<InstitutionView> {
    const institution = await this.prisma.institution.create({
      data: {
        name: input.name,
        seats: input.seats,
        seatPriceInr: input.seatPriceInr,
        billingPeriod: input.billingPeriod,
        ...(input.billingEmail ? { billingEmail: input.billingEmail } : {}),
      },
    });

    // The admin may already have a student account; promoting it is right, creating a second
    // account on the same address is not.
    const email = input.adminEmail.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    const admin = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: { role: 'INSTITUTION_ADMIN', institutionId: institution.id },
          select: { id: true },
        })
      : await this.prisma.user.create({
          data: { email, role: 'INSTITUTION_ADMIN', institutionId: institution.id },
          select: { id: true },
        });

    await this.prisma.auditEvent.create({
      data: {
        kind: 'INSTITUTION_CREATED',
        userId: admin.id,
        actorId,
        detail: {
          institutionId: institution.id,
          name: institution.name,
          seats: institution.seats,
          seatPriceInr: institution.seatPriceInr,
          billingPeriod: institution.billingPeriod,
          promotedExistingAccount: Boolean(existing),
        },
      },
    });

    return this.view(institution.id);
  }

  /** The institution this user administers, or a refusal that says why. */
  async forAdmin(user: SessionUser): Promise<string> {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { institutionId: true, role: true },
    });
    if (!row?.institutionId) {
      throw new NotFoundError('An institution for this account');
    }
    if (row.role !== 'INSTITUTION_ADMIN' && row.role !== 'SUPERADMIN') {
      throw new ForbiddenError('This page is for institution administrators.');
    }
    return row.institutionId;
  }

  async view(institutionId: string): Promise<InstitutionView> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
    });
    if (!institution) throw new NotFoundError('That institution');

    const [members, pending, templates] = await Promise.all([
      this.prisma.user.count({ where: { institutionId, role: 'STUDENT' } }),
      this.prisma.institutionInvite.count({ where: this.pendingWhere(institutionId) }),
      this.prisma.institutionTemplate.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ]);

    const chosen = templates.find((t) => t.id === institution.templateId) ?? null;
    return {
      id: institution.id,
      name: institution.name,
      seats: {
        total: institution.seats,
        members,
        pendingInvites: pending,
        used: members + pending,
        free: Math.max(0, institution.seats - members - pending),
      },
      seatPriceInr: institution.seatPriceInr,
      billingPeriod: institution.billingPeriod,
      billingEmail: institution.billingEmail,
      template: chosen,
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        isExample: t.name === 'EXAMPLE_IN_UNIVERSITY',
      })),
      createdAt: institution.createdAt,
    };
  }

  /** Neither accepted, revoked, nor expired — the invites that are still holding a seat. */
  private pendingWhere(institutionId: string) {
    return {
      institutionId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    };
  }

  async invites(institutionId: string): Promise<InviteRow[]> {
    const rows = await this.prisma.institutionInvite.findMany({
      where: { institutionId },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      status: row.acceptedAt
        ? ('ACCEPTED' as const)
        : row.revokedAt
          ? ('REVOKED' as const)
          : row.expiresAt <= now
            ? ('EXPIRED' as const)
            : ('PENDING' as const),
      invitedAt: row.createdAt,
      expiresAt: row.expiresAt,
      acceptedAt: row.acceptedAt,
    }));
  }

  /**
   * Invites one address. Refused when it would take the institution past its seat count, with the
   * numbers in the message — an admin who has to guess how many seats are left will guess wrong.
   */
  async invite(
    actorId: string,
    institutionId: string,
    rawEmail: string,
  ): Promise<{ invite: InviteRow; seats: SeatCount }> {
    const email = rawEmail.trim().toLowerCase();
    const view = await this.view(institutionId);

    const alreadyMember = await this.prisma.user.findFirst({
      where: { email, institutionId },
      select: { id: true },
    });
    if (alreadyMember) {
      throw new ValidationError(`${email} is already on this institution's roll.`);
    }

    const existing = await this.prisma.institutionInvite.findUnique({
      where: { institutionId_email: { institutionId, email } },
    });
    const holdsASeat =
      existing && !existing.acceptedAt && !existing.revokedAt && existing.expiresAt > new Date();

    // A live invite already holds this address's seat, so re-inviting only extends it.
    if (!holdsASeat && view.seats.free <= 0) {
      throw new ValidationError(
        `All ${view.seats.total} seats are taken — ${view.seats.members} student${view.seats.members === 1 ? '' : 's'} and ${view.seats.pendingInvites} invitation${view.seats.pendingInvites === 1 ? '' : 's'} waiting. Revoke an invitation, or ask us for more seats.`,
      );
    }

    const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
    const row = await this.prisma.institutionInvite.upsert({
      where: { institutionId_email: { institutionId, email } },
      create: { institutionId, email, invitedById: actorId, expiresAt },
      update: { invitedById: actorId, expiresAt, revokedAt: null },
    });

    this.logger.log({ institutionId, email }, 'institution seat invited');
    const invites = await this.invites(institutionId);
    const invite = invites.find((i) => i.id === row.id);
    if (!invite) throw new NotFoundError('That invitation');
    return { invite, seats: (await this.view(institutionId)).seats };
  }

  /** Releases the seat. An accepted invite is not revocable here — remove the member instead. */
  async revoke(
    institutionId: string,
    inviteId: string,
  ): Promise<{ revoked: true; seats: SeatCount }> {
    const row = await this.prisma.institutionInvite.findFirst({
      where: { id: inviteId, institutionId },
    });
    if (!row) throw new NotFoundError('That invitation');
    if (row.acceptedAt) {
      throw new ValidationError(
        `${row.email} has already joined. Removing them from the roll frees the seat.`,
      );
    }
    await this.prisma.institutionInvite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    });
    return { revoked: true, seats: (await this.view(institutionId)).seats };
  }

  /**
   * Takes a member off the roll: back to `FREE_TRIAL`, no institution, seat freed. Their theses
   * are untouched — the work is theirs, and §12.2 does not let a seat ending take it away.
   */
  async removeMember(
    actorId: string,
    institutionId: string,
    userId: string,
  ): Promise<{ removed: true; seats: SeatCount }> {
    const member = await this.prisma.user.findFirst({
      where: { id: userId, institutionId },
      select: { id: true, email: true, role: true },
    });
    if (!member) throw new NotFoundError('That student');
    if (member.role === 'INSTITUTION_ADMIN') {
      throw new ValidationError(
        'That account administers this institution. Ask us to move the admin role first.',
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { institutionId: null, plan: 'FREE_TRIAL' },
    });
    await this.prisma.institutionInvite.updateMany({
      where: { institutionId, email: member.email, acceptedAt: { not: null } },
      data: { revokedAt: new Date() },
    });
    await this.prisma.auditEvent.create({
      data: {
        kind: 'INSTITUTION_SEAT_RELEASED',
        userId,
        actorId,
        detail: { institutionId, email: member.email },
      },
    });
    return { removed: true, seats: (await this.view(institutionId)).seats };
  }

  /** Called at sign-in; the work is in `claim-invite.ts` because the auth hook needs it too. */
  async claimInviteFor(userId: string, email: string): Promise<{ institutionId: string } | null> {
    const claimed = await claimInstitutionInvite(this.prisma, userId, email);
    if (claimed) this.logger.log({ userId, institutionId: claimed.institutionId }, 'seat claimed');
    return claimed ? { institutionId: claimed.institutionId } : null;
  }

  /**
   * Per-student usage for this period. Counts and costs only — this view exists so a department
   * can see whether its seats are being used, not what anyone wrote (§12.2).
   */
  async usage(institutionId: string, now: Date = new Date()): Promise<StudentUsageRow[]> {
    const period = periodFor(now);
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const users = await this.prisma.user.findMany({
      where: { institutionId, role: 'STUDENT' },
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        createdAt: true,
        _count: { select: { documents: true } },
        usage: { where: { period }, select: { action: true, count: true } },
      },
    });
    if (users.length === 0) return [];

    const ids = users.map((u) => u.id);
    const [costs, lastCalls] = await Promise.all([
      this.prisma.aiCallLog.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, createdAt: { gte: from } },
        _sum: { costMicroInr: true },
      }),
      this.prisma.aiCallLog.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _max: { createdAt: true },
      }),
    ]);
    const costByUser = new Map(costs.map((c) => [c.userId, c._sum.costMicroInr ?? 0n]));
    const lastByUser = new Map(lastCalls.map((c) => [c.userId, c._max.createdAt]));

    return users
      .map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        plan: u.plan,
        joinedAt: u.createdAt,
        lastActiveAt: lastByUser.get(u.id) ?? null,
        documents: u._count.documents,
        costInr: toInr(costByUser.get(u.id) ?? 0n),
        usage: METERED_ACTIONS.map((action) => ({
          action: action as AiAction,
          used: u.usage.find((row) => row.action === action)?.count ?? 0,
          cap: PLAN_LIMITS[u.plan as Plan].caps[action] ?? 0,
        })),
      }))
      .sort((a, b) => (b.lastActiveAt?.getTime() ?? 0) - (a.lastActiveAt?.getTime() ?? 0));
  }

  /** D.3.1: every new thesis in this institution starts on its template. */
  async setTemplate(institutionId: string, templateId: string | null): Promise<InstitutionView> {
    if (templateId) {
      const template = await this.prisma.institutionTemplate.findUnique({
        where: { id: templateId },
        select: { id: true },
      });
      if (!template) throw new NotFoundError('That template');
    }
    await this.prisma.institution.update({
      where: { id: institutionId },
      data: { templateId },
    });
    return this.view(institutionId);
  }

  /**
   * The invoice for one period: seats held × the negotiated rate (ADR-0009).
   *
   * Unlike the student invoice, which is built from the Razorpay charge that happened, this is
   * built from the agreement — institutions are billed by arrangement, so there is no charge event
   * to read. `period` is `YYYY-MM` for a monthly agreement and `YYYY` for a yearly one.
   */
  async invoice(institutionId: string, period: string): Promise<InstitutionInvoice> {
    const view = await this.view(institutionId);
    const expected = view.billingPeriod === 'monthly' ? /^\d{4}-\d{2}$/ : /^\d{4}$/;
    if (!expected.test(period)) {
      throw new ValidationError(
        view.billingPeriod === 'monthly'
          ? 'A monthly agreement is invoiced per month, e.g. 2026-09.'
          : 'A yearly agreement is invoiced per year, e.g. 2026.',
      );
    }
    const admin = await this.prisma.user.findFirst({
      where: { institutionId, role: 'INSTITUTION_ADMIN' },
      select: { email: true },
    });
    const seats = view.seats.used;
    return {
      period,
      number: `TC-INST-${period}-${institutionId.slice(0, 6)}`,
      seats,
      seatPriceInr: view.seatPriceInr,
      totalInr: seats * view.seatPriceInr,
      billedTo: view.billingEmail ?? admin?.email ?? view.name,
    };
  }

  /** The same `docx` → Gotenberg path the student invoice and the thesis use. */
  async invoicePdf(
    institutionId: string,
    period: string,
  ): Promise<{ url: string; filename: string; bytes: number; invoice: InstitutionInvoice }> {
    const view = await this.view(institutionId);
    const invoice = await this.invoice(institutionId, period);

    const docx = await invoiceToDocx({
      number: invoice.number,
      date: new Date(),
      billedTo: `${view.name} — ${invoice.billedTo}`,
      planLabel:
        invoice.seatPriceInr > 0
          ? `${invoice.seats} institution seat${invoice.seats === 1 ? '' : 's'} at INR ${invoice.seatPriceInr} each`
          : // §0.3 rule 4: no rate was agreed, so the invoice says so rather than inventing one.
            `${invoice.seats} institution seat${invoice.seats === 1 ? '' : 's'} — no rate has been recorded for this institution`,
      periodLabel: view.billingPeriod === 'monthly' ? `${period}` : `the year ${period}`,
      amountInr: invoice.totalInr,
      seller: { name: 'Thesis Copilot', line2: 'Institution billing' },
    });

    const filename = `institution-invoice-${period}.pdf`;
    const pdf = await this.toPdf(docx, `institution-invoice-${period}.docx`);
    const key = `invoices/institution/${institutionId}/${period}.pdf`;
    await this.storage.put(key, pdf, { 'content-type': 'application/pdf' });
    return {
      url: await this.storage.signedUrl(key),
      filename,
      bytes: pdf.length,
      invoice,
    };
  }

  private async toPdf(docx: Buffer, filename: string): Promise<Buffer> {
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(docx)]), filename);
    const response = await fetch(`${this.env.GOTENBERG_URL}/forms/libreoffice/convert`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) throw new Error(`Gotenberg refused the conversion (HTTP ${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }
}
