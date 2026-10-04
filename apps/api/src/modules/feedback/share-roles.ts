/**
 * The three things a person a thesis is shared with may be (ADR-0057).
 *
 * Stored as two booleans on `GuideShare` rather than an enum, because `canEdit` (ADR-0028) is what
 * the live editor, the chapter build and the document detail already ask, and a second column that
 * had to agree with it would be a second source of truth. The role is the name the owner sees; the
 * booleans are what every permission check reads. A co-author always comments too, so only three
 * of the four combinations are reachable through here.
 *
 *   GUIDE     — reads, comments, suggests revisions in comments (the committee cycle, D.2)
 *   COAUTHOR  — all of that, and types in a chapter live (ADR-0028)
 *   READER    — reads. No comment box, no one else's comments, no AI, nothing writable.
 */

import { z } from 'zod';

export const SHARE_ROLES = ['GUIDE', 'COAUTHOR', 'READER'] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];

export const shareRole = z.enum(SHARE_ROLES);

export type ShareFlags = { canEdit: boolean; canComment: boolean };

export function flagsFor(role: ShareRole): ShareFlags {
  switch (role) {
    case 'COAUTHOR':
      return { canEdit: true, canComment: true };
    case 'READER':
      return { canEdit: false, canComment: false };
    default:
      return { canEdit: false, canComment: true };
  }
}

/** A row as stored, named. `canEdit` wins: a co-author who somehow lost comment rights still writes. */
export function roleOf(share: ShareFlags): ShareRole {
  if (share.canEdit) return 'COAUTHOR';
  return share.canComment ? 'GUIDE' : 'READER';
}

/**
 * What the request asked for. `role` is the current field; `canEdit` is what the share dialog sent
 * before ADR-0057 and an older tab may still send, so it keeps meaning what it meant.
 */
export function requestedRole(body: { role?: ShareRole; canEdit?: boolean }): ShareRole {
  if (body.role) return body.role;
  return body.canEdit ? 'COAUTHOR' : 'GUIDE';
}
