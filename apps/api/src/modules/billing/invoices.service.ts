/**
 * Invoices — PRD FR-9.5, §2.5, PHASES v2 W11.2 ("invoice PDF per charge").
 *
 * An invoice is built from the charge that actually happened — the `BILLING_EVENT` audit row for
 * a `subscription.charged` — not from the plan the user is on now. That is what makes it an
 * invoice rather than a statement: it says what was billed on that date, and it stays true after a
 * plan change.
 *
 * The document goes through the same `docx` → Gotenberg path as a thesis export, so there is one
 * PDF pipeline in the product rather than two.
 */

import { Inject, Injectable } from '@nestjs/common';
import { type Env, type Plan, PRICING } from '@tc/config';
import { invoiceToDocx } from '@tc/export';
import { ENV } from '../../common/env.token.js';
import { NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { StorageService } from '../../common/storage.service.js';

export type InvoiceRow = {
  /** The audit row's id; also the invoice number's suffix. */
  id: string;
  number: string;
  date: string;
  plan: string;
  amountInr: number;
  periodEnd: string | null;
};

type BillingDetail = {
  event?: string;
  status?: string;
  periodEnd?: string;
  providerEventId?: string;
};

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Every charge on this account, newest first. */
  async list(userId: string): Promise<InvoiceRow[]> {
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        userId,
        kind: 'BILLING_EVENT',
        detail: { path: ['event'], equals: 'subscription.charged' },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
      select: { plan: true },
    });
    const plan = (subscription?.plan ?? 'STUDENT_MONTHLY') as Plan;

    return rows.map((row) => {
      const detail = (row.detail ?? {}) as BillingDetail;
      return {
        id: row.id,
        number: invoiceNumber(row.createdAt, row.id),
        date: row.createdAt.toISOString(),
        plan,
        amountInr: PRICING[plan].priceInr,
        periodEnd: detail.periodEnd ?? null,
      };
    });
  }

  /** One invoice as a PDF, stored and handed back as a signed link. */
  async pdf(
    user: { id: string; email: string },
    invoiceId: string,
  ): Promise<{ url: string; filename: string; bytes: number }> {
    const row = await this.prisma.auditEvent.findFirst({
      where: { id: invoiceId, userId: user.id, kind: 'BILLING_EVENT' },
    });
    if (!row) throw new NotFoundError('That invoice');

    const subscription = await this.prisma.subscription.findUnique({
      where: { userId: user.id },
      select: { plan: true },
    });
    const plan = (subscription?.plan ?? 'STUDENT_MONTHLY') as Plan;
    const pricing = PRICING[plan];
    const detail = (row.detail ?? {}) as BillingDetail;
    const number = invoiceNumber(row.createdAt, row.id);

    const docx = await invoiceToDocx({
      number,
      date: row.createdAt,
      billedTo: user.email,
      planLabel: planLabel(plan),
      periodLabel: pricing.period === 'yearly' ? 'one year' : 'one month',
      amountInr: pricing.priceInr,
      accessThrough: detail.periodEnd ? detail.periodEnd.slice(0, 10) : null,
    });

    const pdf = await this.toPdf(docx, `${number}.docx`);
    const key = `invoices/${user.id}/${number}.pdf`;
    await this.storage.put(key, pdf, { 'content-type': 'application/pdf' });
    return {
      url: await this.storage.signedUrl(key),
      filename: `${number}.pdf`,
      bytes: pdf.length,
    };
  }

  private async toPdf(docx: Buffer, filename: string): Promise<Buffer> {
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(docx)]), filename);
    const response = await fetch(`${this.env.GOTENBERG_URL}/forms/libreoffice/convert`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      throw new Error(`Gotenberg refused the conversion (HTTP ${response.status})`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

const planLabel = (plan: Plan): string =>
  plan === 'STUDENT_ANNUAL'
    ? 'Student, annual'
    : plan === 'STUDENT_MONTHLY'
      ? 'Student, monthly'
      : plan;

/** `TC-2026-09-1a2b3c` — sortable, unique, and readable in a bank statement query. */
function invoiceNumber(at: Date, id: string): string {
  const month = at.toISOString().slice(0, 7);
  return `TC-${month}-${id.replace(/-/g, '').slice(0, 6)}`;
}
