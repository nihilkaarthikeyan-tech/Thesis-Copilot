/**
 * `/prompts` — the signed-in student's saved prompts (ADR-0019).
 *
 * Plain CRUD. A saved prompt is only ever *sent* through `/chat`, so none of these routes touches
 * a model, a cap or a document.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { PROMPT_LIMITS, PromptsService } from './prompts.service.js';

const title = z.string().trim().min(1).max(PROMPT_LIMITS.maxTitle);
const body = z.string().trim().min(1).max(PROMPT_LIMITS.maxBody);

const createBody = z.object({ title, body });
const updateBody = z
  .object({ title: title.optional(), body: body.optional() })
  .refine((v) => v.title !== undefined || v.body !== undefined, 'Nothing to change');

@Controller('prompts')
@UseGuards(SessionGuard)
export class PromptsController {
  constructor(private readonly prompts: PromptsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.prompts.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: SessionUser, @Body() input: unknown) {
    const parsed = createBody.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError('A saved prompt needs a name and some text', parsed.error.issues);
    }
    return this.prompts.create(user.id, parsed.data);
  }

  @Patch(':promptId')
  update(
    @CurrentUser() user: SessionUser,
    @Param('promptId') promptId: string,
    @Body() input: unknown,
  ) {
    const parsed = updateBody.safeParse(input);
    if (!parsed.success) throw new ValidationError('Invalid saved prompt', parsed.error.issues);
    return this.prompts.update(user.id, promptId, parsed.data);
  }

  @Delete(':promptId')
  @HttpCode(204)
  async remove(@CurrentUser() user: SessionUser, @Param('promptId') promptId: string) {
    await this.prompts.remove(user.id, promptId);
  }
}
