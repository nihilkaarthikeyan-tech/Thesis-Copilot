/**
 * Prisma client for the whole monorepo.
 *
 * The schema lives in `prisma/schema.prisma` and is copied from PRD §8.
 * Product code imports types and the client from here, never from `@prisma/client` directly, so the
 * generated client stays swappable.
 */

export {
  type AiAction,
  type CommentClass,
  type CommentStatus,
  type EntryPath,
  type FlagType,
  type GroundingLevel,
  Prisma,
  PrismaClient,
  type Provenance,
  type Role,
  type Severity,
  type SourceStatus,
  type Template,
} from '@prisma/client';

export { AI_ACTION_VALUES } from './enums.js';
