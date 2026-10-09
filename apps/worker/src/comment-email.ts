/**
 * Comments and replies send an email — ADR-0142 (owner's decision, 2026-10-09).
 *
 * A new comment or reply emails the other people who can see the thesis's comments: the student
 * who owns it, and every share that may comment (a guide) or edit (a co-author). Never the person
 * who wrote it, never a Reader (ADR-0057), never an account that is suspended or being deleted,
 * and never someone who turned "Email me about comments and replies" off.
 *
 * At most one email per thread per person per hour. The API queues an `event` job; this file fans
 * it out to one delayed `send` job per person, whose id keys on the thread, the person and the
 * throttle slot (their last email about the thread plus an hour). Every event inside one hour
 * therefore lands on the same job, and that one email folds them in ("and 2 more replies").
 *
 * The send claims its slot with one conditional `updateMany` on `CommentEmailState` (the row's
 * `lastSentAt` must be an hour old and its cursor unchanged), so a retry or a second worker never
 * sends twice. The email is plain text: the thesis title, who wrote, the first ~200 characters of
 * what they wrote (never the thesis text), one link to the comment, and the way out.
 */

import type { PrismaClient } from '@tc/db';
import { type Mailer, unsubscribeToken } from '@tc/mail';
import { type CommentEmailJob, commentSendJobId } from '@tc/types';

export const COMMENT_EMAIL = {
  /** One email per thread per person within this long. */
  throttleMs: 60 * 60_000,
  /**
   * The first email waits this long, so a reply typed straight after the comment (or a second
   * thought a minute later) arrives in the same email rather than starting the hour's clock.
   */
  graceMs: 60_000,
  /** How much of the comment the email quotes. */
  excerptChars: 200,
} as const;

/** Default on: only an explicit `false` turns comment emails off. */
export function commentEmailsOn(settings: unknown): boolean {
  return (settings as { emailOnComments?: unknown } | null)?.emailOnComments !== false;
}

export type Language = 'en' | 'hi';

export function languageOf(settings: unknown): Language {
  return (settings as { interfaceLanguage?: unknown } | null)?.interfaceLanguage === 'hi'
    ? 'hi'
    : 'en';
}

type UserRow = {
  id: string;
  email: string;
  suspendedAt: Date | null;
  deletionRequestedAt: Date | null;
  deletedAt: Date | null;
};

const active = (user: UserRow | null | undefined): user is UserRow =>
  !!user?.email && !user.suspendedAt && !user.deletionRequestedAt && !user.deletedAt;

const USER_SELECT = {
  id: true,
  email: true,
  suspendedAt: true,
  deletionRequestedAt: true,
  deletedAt: true,
} as const;

export type Recipient = { userId: string; email: string; shareToken: string | null };

/**
 * Everyone with an active account who can see this thesis's comments: the owner, and each share
 * that comments or edits, matched to its account the way `SharesService.assertShared` matches it
 * (the bound user, or the invited address). A share whose guide has no account yet is skipped —
 * they cannot have seen a comment, and with no account there is no switch to turn the mail off.
 */
export async function commentRecipients(
  prisma: PrismaClient,
  documentId: string,
): Promise<Recipient[]> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { owner: { select: USER_SELECT } },
  });
  if (!document) return [];
  const out = new Map<string, Recipient>();
  if (active(document.owner)) {
    out.set(document.owner.id, {
      userId: document.owner.id,
      email: document.owner.email.toLowerCase(),
      shareToken: null,
    });
  }
  const shares = await prisma.guideShare.findMany({
    where: { documentId, OR: [{ canComment: true }, { canEdit: true }] },
    orderBy: { createdAt: 'asc' },
    select: { guideEmail: true, token: true, guide: { select: USER_SELECT } },
  });
  const unbound = shares.filter((s) => !s.guide).map((s) => s.guideEmail.toLowerCase());
  const byEmail = new Map(
    (unbound.length
      ? await prisma.user.findMany({ where: { email: { in: unbound } }, select: USER_SELECT })
      : []
    ).map((u) => [u.email.toLowerCase(), u]),
  );
  for (const share of shares) {
    const user = share.guide ?? byEmail.get(share.guideEmail.toLowerCase());
    if (!active(user) || out.has(user.id)) continue;
    out.set(user.id, { userId: user.id, email: user.email.toLowerCase(), shareToken: share.token });
  }
  return [...out.values()];
}

/** When the hour's throttle opens for this person and thread: 0 when never mailed. */
export function slotOf(lastSentAt: Date | null | undefined): number {
  return lastSentAt ? lastSentAt.getTime() + COMMENT_EMAIL.throttleMs : 0;
}

/** How long a `send` for this slot waits: to the slot, and at least the grace minute. */
export function delayFor(slot: number, now: number): number {
  return Math.max(COMMENT_EMAIL.graceMs, slot - now);
}

export type Enqueue = (
  payload: Extract<CommentEmailJob, { kind: 'send' }>,
  options: { jobId: string; delayMs: number },
) => Promise<void>;

export type CommentEmailDeps = {
  prisma: PrismaClient;
  mailer: Mailer;
  enqueue: Enqueue;
  appUrl: string;
  /** `AUTH_SECRET`: signs the unsubscribe link. */
  secret: string;
  now?: () => number;
  log?: (event: Record<string, unknown>) => void;
};

/** The thread's events, oldest first: the comment itself, then its replies. */
async function threadOf(prisma: PrismaClient, commentId: string) {
  return prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      documentId: true,
      chapterId: true,
      authorEmail: true,
      body: true,
      createdAt: true,
      document: { select: { title: true, ownerId: true } },
      replies: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, authorEmail: true, body: true, createdAt: true },
      },
    },
  });
}

type ThreadEvent = {
  kind: 'comment' | 'reply';
  authorEmail: string;
  body: string;
  createdAt: Date;
};

function eventsOf(thread: NonNullable<Awaited<ReturnType<typeof threadOf>>>): ThreadEvent[] {
  return [
    {
      kind: 'comment' as const,
      authorEmail: thread.authorEmail,
      body: thread.body,
      createdAt: thread.createdAt,
    },
    ...thread.replies.map((r) => ({
      kind: 'reply' as const,
      authorEmail: r.authorEmail,
      body: r.body,
      createdAt: r.createdAt,
    })),
  ];
}

/**
 * Step one: a comment or reply was written. Queues one `send` per other person who can see the
 * comments. A person seen for the first time on this thread gets a state row whose cursor sits
 * just before this event, so their first email starts here rather than at the thread's beginning.
 */
export async function fanOutCommentEvent(
  deps: CommentEmailDeps,
  job: Extract<CommentEmailJob, { kind: 'event' }>,
): Promise<{ queued: number }> {
  const now = (deps.now ?? Date.now)();
  const thread = await threadOf(deps.prisma, job.commentId);
  if (!thread || thread.documentId !== job.documentId) return { queued: 0 };
  const event =
    job.eventId === thread.id
      ? { authorEmail: thread.authorEmail, createdAt: thread.createdAt }
      : thread.replies.find((r) => r.id === job.eventId);
  // A reply taken back before this ran: nothing to tell anyone.
  if (!event) return { queued: 0 };
  const author = event.authorEmail.toLowerCase();

  const recipients = (await commentRecipients(deps.prisma, thread.documentId)).filter(
    (r) => r.email !== author,
  );
  for (const recipient of recipients) {
    await deps.prisma.commentEmailState.createMany({
      data: [
        {
          commentId: thread.id,
          userId: recipient.userId,
          cursorAt: new Date(event.createdAt.getTime() - 1),
        },
      ],
      skipDuplicates: true,
    });
    const state = await deps.prisma.commentEmailState.findUniqueOrThrow({
      where: { commentId_userId: { commentId: thread.id, userId: recipient.userId } },
      select: { lastSentAt: true },
    });
    const slot = slotOf(state.lastSentAt);
    await deps.enqueue(
      { kind: 'send', commentId: thread.id, userId: recipient.userId, slot },
      { jobId: commentSendJobId(thread.id, recipient.userId, slot), delayMs: delayFor(slot, now) },
    );
  }
  return { queued: recipients.length };
}

export type SendOutcome =
  | 'sent'
  | 'no-recipient'
  | 'no-access'
  | 'no-thread'
  | 'nothing-new'
  | 'opted-out'
  | 'throttled';

/**
 * Step two: one email to one person about one thread, folding in every event since their cursor.
 * A mail fault puts the claim back and throws, so BullMQ's retry tries again with the same events.
 */
export async function sendCommentEmail(
  deps: CommentEmailDeps,
  job: Extract<CommentEmailJob, { kind: 'send' }>,
): Promise<{ outcome: SendOutcome; events?: number }> {
  const now = (deps.now ?? Date.now)();
  const log = deps.log ?? (() => undefined);
  const user = await deps.prisma.user.findUnique({
    where: { id: job.userId },
    select: { ...USER_SELECT, name: true, settings: true },
  });
  if (!active(user)) return { outcome: 'no-recipient' };
  const me = user.email.toLowerCase();

  const thread = await threadOf(deps.prisma, job.commentId);
  if (!thread) return { outcome: 'no-thread' };

  // Still allowed to see the comments now, not merely when the comment was written.
  let shareToken: string | null = null;
  if (thread.document.ownerId !== user.id) {
    const share = await deps.prisma.guideShare.findFirst({
      where: {
        documentId: thread.documentId,
        OR: [{ guideUserId: user.id }, { guideEmail: me }],
        AND: [{ OR: [{ canComment: true }, { canEdit: true }] }],
      },
      select: { token: true },
    });
    if (!share) return { outcome: 'no-access' };
    shareToken = share.token;
  }

  const key = { commentId_userId: { commentId: thread.id, userId: user.id } };
  const state =
    (await deps.prisma.commentEmailState.findUnique({ where: key })) ??
    (await deps.prisma.commentEmailState.create({
      data: {
        commentId: thread.id,
        userId: user.id,
        cursorAt: new Date(thread.createdAt.getTime() - 1),
      },
    }));

  const after = eventsOf(thread).filter((e) => e.createdAt > state.cursorAt);
  if (after.length === 0) return { outcome: 'nothing-new' };
  const newest = after.reduce((a, e) => (e.createdAt > a ? e.createdAt : a), state.cursorAt);
  const theirs = after.filter((e) => e.authorEmail.toLowerCase() !== me);

  // Nothing by anyone else, or the person turned these off: account for the events and stop, so
  // switching back on later does not deliver a backlog.
  const optedOut = !commentEmailsOn(user.settings);
  if (theirs.length === 0 || optedOut) {
    await deps.prisma.commentEmailState.updateMany({
      where: { commentId: thread.id, userId: user.id, cursorAt: state.cursorAt },
      data: { cursorAt: newest },
    });
    return { outcome: optedOut ? 'opted-out' : 'nothing-new' };
  }

  // The claim: an hour since the last email, and nobody else has moved the cursor meanwhile.
  const sentAt = new Date(now);
  const claimed = await deps.prisma.commentEmailState.updateMany({
    where: {
      commentId: thread.id,
      userId: user.id,
      cursorAt: state.cursorAt,
      OR: [{ lastSentAt: null }, { lastSentAt: { lte: new Date(now - COMMENT_EMAIL.throttleMs) } }],
    },
    data: { lastSentAt: sentAt, cursorAt: newest },
  });
  if (claimed.count === 0) {
    await scheduleNext(deps, thread.id, user.id, now);
    return { outcome: 'throttled' };
  }

  const first = theirs[0] as ThreadEvent;
  const authorName = await nameOf(deps.prisma, first.authorEmail);
  const mail = commentEmail({
    language: languageOf(user.settings),
    thesisTitle: thread.document.title,
    authorName,
    kind: first.kind,
    body: first.body,
    more: theirs.length - 1,
    link: commentLink(deps.appUrl, {
      documentId: thread.documentId,
      commentId: thread.id,
      chapterId: thread.chapterId,
      shareToken,
    }),
    appUrl: deps.appUrl,
    unsubscribeToken: unsubscribeToken(deps.secret, user.id),
  });
  try {
    await deps.mailer.send({ to: [user.email], ...mail });
  } catch (error) {
    // Put the claim back so the retry finds the same events.
    await deps.prisma.commentEmailState.updateMany({
      where: { commentId: thread.id, userId: user.id, lastSentAt: sentAt, cursorAt: newest },
      data: { lastSentAt: state.lastSentAt, cursorAt: state.cursorAt },
    });
    throw error;
  }
  log({ msg: 'comment email sent', commentId: thread.id, userId: user.id, events: theirs.length });
  // An event written while this ran was queued under this job's id and dropped; queue it now.
  await scheduleNext(deps, thread.id, user.id, now);
  return { outcome: 'sent', events: theirs.length };
}

/** Queues the next slot's send when events by others are waiting past the cursor. */
async function scheduleNext(
  deps: CommentEmailDeps,
  commentId: string,
  userId: string,
  now: number,
): Promise<void> {
  const [state, user, thread] = await Promise.all([
    deps.prisma.commentEmailState.findUnique({
      where: { commentId_userId: { commentId, userId } },
    }),
    deps.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    threadOf(deps.prisma, commentId),
  ]);
  if (!state || !user || !thread) return;
  const me = user.email.toLowerCase();
  const waiting = eventsOf(thread).some(
    (e) => e.createdAt > state.cursorAt && e.authorEmail.toLowerCase() !== me,
  );
  if (!waiting) return;
  const slot = slotOf(state.lastSentAt);
  await deps.enqueue(
    { kind: 'send', commentId, userId, slot },
    { jobId: commentSendJobId(commentId, userId, slot), delayMs: delayFor(slot, now) },
  );
}

async function nameOf(prisma: PrismaClient, email: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { name: true },
  });
  return user?.name?.trim() || email;
}

/** Where the comment is: the review queue for the owner, the share's page for a guide. */
export function commentLink(
  appUrl: string,
  at: {
    documentId: string;
    commentId: string;
    chapterId: string | null;
    shareToken: string | null;
  },
): string {
  const origin = appUrl.replace(/\/+$/, '');
  if (!at.shareToken) return `${origin}/app/d/${at.documentId}/review?comment=${at.commentId}`;
  const chapter = at.chapterId ? `&chapter=${at.chapterId}` : '';
  return `${origin}/guide/${at.shareToken}?comment=${at.commentId}${chapter}`;
}

/** The first ~200 characters, whitespace collapsed, cut at a word where one is near. */
export function excerpt(text: string, max: number = COMMENT_EMAIL.excerptChars): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export type CommentEmailInput = {
  language: Language;
  thesisTitle: string;
  authorName: string;
  kind: 'comment' | 'reply';
  body: string;
  /** Further events by others folded into this email. */
  more: number;
  link: string;
  appUrl: string;
  unsubscribeToken: string;
};

/** Plain text, no tracking: who, on which thesis, what they began with, and one link. */
export function commentEmail(input: CommentEmailInput): { subject: string; text: string } {
  const origin = input.appUrl.replace(/\/+$/, '');
  const title = input.thesisTitle.trim() || (input.language === 'hi' ? 'आपकी थीसिस' : 'a thesis');
  const quote = excerpt(input.body);
  const unsubscribe = `${origin}/unsubscribe?token=${encodeURIComponent(input.unsubscribeToken)}`;
  const account = `${origin}/app/account`;
  const n = input.more;

  if (input.language === 'hi') {
    const did = input.kind === 'comment' ? 'पर टिप्पणी की' : 'पर एक टिप्पणी का जवाब दिया';
    return {
      subject: `${input.authorName} ने "${title}" ${did}`,
      text: [
        `${input.authorName} ने "${title}" ${did}:`,
        '',
        `"${quote}"`,
        ...(n > 0 ? ['', `इसके बाद ${n} और जवाब आए।`] : []),
        '',
        `यहाँ देखें: ${input.link}`,
        '',
        'यह ईमेल आपको इसलिए मिला क्योंकि आप इस थीसिस की टिप्पणियाँ देख सकते हैं।',
        `इन्हें बंद करने के लिए अपने खाते में "टिप्पणियों और जवाबों के बारे में मुझे ईमेल करें" बंद करें: ${account}`,
        `या एक क्लिक में बंद करें: ${unsubscribe}`,
        '',
        'Thesis Copilot',
      ].join('\n'),
    };
  }

  const did = input.kind === 'comment' ? 'commented on' : 'replied to a comment on';
  return {
    subject: `${input.authorName} ${did} "${title}"`,
    text: [
      `${input.authorName} ${did} "${title}":`,
      '',
      `"${quote}"`,
      ...(n > 0 ? ['', `And ${n} more ${n === 1 ? 'reply' : 'replies'} since.`] : []),
      '',
      `See it here: ${input.link}`,
      '',
      'You get this because you can see the comments on this thesis. To stop these emails, turn off',
      `"Email me about comments and replies" in your account: ${account}`,
      `Or turn them off with one click: ${unsubscribe}`,
      '',
      'Thesis Copilot',
    ].join('\n'),
  };
}
