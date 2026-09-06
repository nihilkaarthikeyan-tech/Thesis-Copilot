/**
 * `/billing/*` — PRD FR-9.5, §9.4, PHASES v2 W11.1–W11.2.
 *
 * The webhook is the only unauthenticated route in the application, and the only one that reads a
 * raw body: Razorpay signs the exact bytes it sent, so a re-serialised object would not verify.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Env } from '@tc/config';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ENV } from '../../common/env.token.js';
import { UnauthorizedError, ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { BillingService } from './billing.service.js';
import { InvoicesService } from './invoices.service.js';

const subscribeBody = z.object({ plan: z.string().trim().min(1).max(40) });

/** The part of Razorpay's payload this acts on; everything else is logged and ignored. */
const webhookPayload = z.object({
  event: z.string(),
  payload: z.object({
    subscription: z
      .object({
        entity: z.object({
          id: z.string(),
          status: z.string().optional(),
          plan_id: z.string().optional(),
          current_end: z.number().nullable().optional(),
          current_start: z.number().nullable().optional(),
          notes: z.record(z.string(), z.string()).nullable().optional(),
        }),
      })
      .optional(),
  }),
});

@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly billing: BillingService,
    private readonly invoices: InvoicesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @UseGuards(SessionGuard)
  view(@CurrentUser() user: SessionUser) {
    return this.billing.view(user.id);
  }

  @Post('subscribe')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  subscribe(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = subscribeBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Pick a plan', parsed.error.issues);
    return this.billing.subscribe(user, parsed.data.plan);
  }

  /** FR-9.5: an invoice per charge. */
  @Get('invoices')
  @UseGuards(SessionGuard)
  invoiceList(@CurrentUser() user: SessionUser) {
    return this.invoices.list(user.id);
  }

  @Post('invoices/:id')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  invoicePdf(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.invoices.pdf(user, id);
  }

  /** FR-9.5: one click, any device. Nothing is lost today — it stops the next renewal. */
  @Post('cancel')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  cancel(@CurrentUser() user: SessionUser) {
    return this.billing.cancel(user.id);
  }

  /**
   * Razorpay's webhook. Unauthenticated by necessity and verified by HMAC: the signature is over
   * the raw bytes, compared in constant time.
   */
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() request: FastifyRequest,
    @Headers('x-razorpay-signature') signature: string | undefined,
  ) {
    const secret = this.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.warn('webhook received but RAZORPAY_WEBHOOK_SECRET is not set');
      throw new UnauthorizedError('Webhooks are not configured.');
    }
    const raw = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
    if (!raw || !signature || !verify(raw, signature, secret)) {
      throw new UnauthorizedError('Bad webhook signature.');
    }

    const parsed = webhookPayload.safeParse(JSON.parse(raw.toString('utf8')));
    if (!parsed.success) return { ok: true, applied: false, reason: 'unrecognised payload' };
    const entity = parsed.data.payload.subscription?.entity;
    if (!entity) return { ok: true, applied: false, reason: 'not a subscription event' };

    // Razorpay has no per-delivery event id header in every version; the subscription id plus the
    // event name and the period start identify one state change without one.
    const id = `${entity.id}:${parsed.data.event}:${entity.current_start ?? 0}`;
    const result = await this.billing.applyEvent({
      id,
      event: parsed.data.event,
      subscription: {
        id: entity.id,
        ...(entity.status ? { status: entity.status } : {}),
        ...(entity.plan_id ? { plan_id: entity.plan_id } : {}),
        current_end: entity.current_end ?? null,
        current_start: entity.current_start ?? null,
        notes: entity.notes ?? null,
      },
    });
    // Always 200: a non-2xx makes Razorpay retry an event we have already decided about.
    return { ok: true, ...result };
  }
}

function verify(raw: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
