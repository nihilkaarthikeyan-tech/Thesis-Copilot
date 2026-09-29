/** Types shared by the `/admin/users` pages (Next allows no extra page exports). */

import type { UserStatus } from '@/components/admin/kit';

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  plan: string;
  createdAt: string;
  lastActiveAt: string | null;
  documents: number;
  costInr: number;
  /** `cap` already includes `bonus`, the extra an admin gave for this month. */
  usage: Array<{ action: string; used: number; cap: number; bonus: number }>;
  status: UserStatus;
};

export type UserDetail = UserRow & {
  documentList: Array<{
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    chapters: number;
    words: number;
  }>;
  capExceeded: number;
  recentEvents: Array<{
    kind: string;
    actorId: string | null;
    actorEmail: string | null;
    detail: unknown;
    createdAt: string;
  }>;
  signInMethods: string[];
  sessions: number;
  suspendedAt: string | null;
  suspendedReason: string | null;
  deletionRequestedAt: string | null;
};
