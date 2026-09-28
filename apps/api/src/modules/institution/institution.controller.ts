/**
 * Institution admin routes — PRD FR-9.6, PHASES v2 B4.1.
 *
 * `/institutions/me` is the admin's own institution, resolved from their account rather than from
 * a path parameter: an institution admin has exactly one, and an id in the URL is one more thing
 * that can be swapped for someone else's.
 *
 * Creating an institution is SUPERADMIN — it sets a negotiated price and a seat count, which is a
 * commercial decision, not a self-service one.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { SuperadminGuard } from '../admin/superadmin.guard.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { InstitutionService, USAGE_PAGE_DEFAULT, USAGE_PAGE_MAX } from './institution.service.js';

const createBody = z.object({
  name: z.string().trim().min(1, 'Name the institution').max(200),
  seats: z.number().int().min(1, 'An institution needs at least one seat').max(10_000),
  adminEmail: z.string().trim().email('That is not an email address'),
  // §11.6 prices a seat at ₹200–250 "negotiated". The agreed number is typed in here; 0 means no
  // rate was agreed yet and the invoice will say so rather than invent one (§0.3 rule 4).
  seatPriceInr: z.number().int().min(0).max(100_000).default(0),
  billingPeriod: z.enum(['monthly', 'yearly']).default('yearly'),
  billingEmail: z.string().trim().email().optional(),
});

const usagePage = z.object({
  limit: z.coerce.number().int().min(1).max(USAGE_PAGE_MAX).default(USAGE_PAGE_DEFAULT),
  offset: z.coerce.number().int().min(0).default(0),
});

const inviteBody = z.object({
  email: z.string().trim().email('That is not an email address'),
});

const templateBody = z.object({
  templateId: z.string().uuid().nullable(),
});

@Controller()
@UseGuards(SessionGuard)
export class InstitutionController {
  constructor(private readonly institutions: InstitutionService) {}

  /** SUPERADMIN: set up an institution and its first admin. */
  @Post('admin/institutions')
  @UseGuards(SuperadminGuard)
  create(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = createBody.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('The institution could not be created.', parsed.error.issues);
    }
    return this.institutions.create(user.id, parsed.data);
  }

  @Get('institutions/me')
  async me(@CurrentUser() user: SessionUser) {
    return this.institutions.view(await this.institutions.forAdmin(user));
  }

  /** `?status=PENDING` for the ones still holding a seat; the full history otherwise. */
  @Get('institutions/me/invites')
  async invites(@CurrentUser() user: SessionUser, @Query('status') status?: string) {
    if (status !== undefined && status !== 'PENDING') {
      throw new ValidationError('status may only be PENDING');
    }
    return this.institutions.invites(await this.institutions.forAdmin(user), status === 'PENDING');
  }

  @Post('institutions/me/invites')
  @HttpCode(200)
  async invite(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = inviteBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Check the address', parsed.error.issues);
    const institutionId = await this.institutions.forAdmin(user);
    return this.institutions.invite(user.id, institutionId, parsed.data.email);
  }

  @Delete('institutions/me/invites/:inviteId')
  async revoke(@CurrentUser() user: SessionUser, @Param('inviteId') inviteId: string) {
    return this.institutions.revoke(await this.institutions.forAdmin(user), inviteId);
  }

  /** Per-student usage. Counts and costs — never a title or a word of anyone's thesis (§12.2). */
  @Get('institutions/me/usage')
  async usage(@CurrentUser() user: SessionUser, @Query() query: unknown) {
    const parsed = usagePage.safeParse(query ?? {});
    if (!parsed.success) throw new ValidationError('Invalid page', parsed.error.issues);
    return this.institutions.usage(await this.institutions.forAdmin(user), new Date(), parsed.data);
  }

  @Get('institutions/me/usage/count')
  async usageCount(@CurrentUser() user: SessionUser) {
    return this.institutions.studentCount(await this.institutions.forAdmin(user));
  }

  @Delete('institutions/me/students/:userId')
  async remove(@CurrentUser() user: SessionUser, @Param('userId') userId: string) {
    const institutionId = await this.institutions.forAdmin(user);
    return this.institutions.removeMember(user.id, institutionId, userId);
  }

  @Put('institutions/me/template')
  async setTemplate(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = templateBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Pick a template', parsed.error.issues);
    const institutionId = await this.institutions.forAdmin(user);
    return this.institutions.setTemplate(institutionId, parsed.data.templateId);
  }

  @Get('institutions/me/invoices/:period')
  async invoice(@CurrentUser() user: SessionUser, @Param('period') period: string) {
    return this.institutions.invoice(await this.institutions.forAdmin(user), period);
  }

  @Post('institutions/me/invoices/:period')
  @HttpCode(200)
  async invoicePdf(@CurrentUser() user: SessionUser, @Param('period') period: string) {
    return this.institutions.invoicePdf(await this.institutions.forAdmin(user), period);
  }
}
