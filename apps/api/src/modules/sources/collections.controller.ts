/**
 * Collections (folders) in the library — see `collections.service.ts`.
 *
 *   GET    /documents/:id/collections              the strip, in order, with counts
 *   POST   /documents/:id/collections              { name }
 *   PUT    /documents/:id/collections/order        { ids } — every collection, in the new order
 *   PATCH  /collections/:id                        { name }
 *   DELETE /collections/:id                        the papers stay in the library
 *   POST   /collections/:id/sources                { sourceIds } — add
 *   POST   /collections/:id/sources/remove         { sourceIds } — take out
 */

import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { CollectionsService } from './collections.service.js';

/** Length is checked after trimming, in the service, so "  " is "give it a name", not a 400 here. */
const nameBody = z.object({ name: z.string().max(200) });
const orderBody = z.object({ ids: z.array(z.string().uuid()).max(500) });
/** A library is at most a few hundred papers; "select all" on it fits. */
const sourcesBody = z.object({ sourceIds: z.array(z.string().uuid()).min(1).max(1000) });

function parse<T>(schema: z.ZodType<T>, body: unknown, message: string): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ValidationError(message, parsed.error.issues);
  return parsed.data;
}

@Controller()
@UseGuards(SessionGuard)
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get('documents/:id/collections')
  list(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.collections.list(user.id, documentId);
  }

  @Post('documents/:id/collections')
  create(@CurrentUser() user: SessionUser, @Param('id') documentId: string, @Body() body: unknown) {
    const { name } = parse(nameBody, body, 'Give the collection a name.');
    return this.collections.create(user.id, documentId, name);
  }

  @Put('documents/:id/collections/order')
  reorder(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const { ids } = parse(orderBody, body, 'List the collections in their new order.');
    return this.collections.reorder(user.id, documentId, ids);
  }

  @Patch('collections/:id')
  rename(
    @CurrentUser() user: SessionUser,
    @Param('id') collectionId: string,
    @Body() body: unknown,
  ) {
    const { name } = parse(nameBody, body, 'Give the collection a name.');
    return this.collections.rename(user.id, collectionId, name);
  }

  @Delete('collections/:id')
  remove(@CurrentUser() user: SessionUser, @Param('id') collectionId: string) {
    return this.collections.remove(user.id, collectionId);
  }

  @Post('collections/:id/sources')
  addSources(
    @CurrentUser() user: SessionUser,
    @Param('id') collectionId: string,
    @Body() body: unknown,
  ) {
    const { sourceIds } = parse(sourcesBody, body, 'Choose the papers to add.');
    return this.collections.addSources(user.id, collectionId, sourceIds);
  }

  @Post('collections/:id/sources/remove')
  removeSources(
    @CurrentUser() user: SessionUser,
    @Param('id') collectionId: string,
    @Body() body: unknown,
  ) {
    const { sourceIds } = parse(sourcesBody, body, 'Choose the papers to take out.');
    return this.collections.removeSources(user.id, collectionId, sourceIds);
  }
}
