/**
 * Turning an invitation into a seat — PRD FR-9.6, ADR-0009, PHASES v2 B4.1.
 *
 * A plain function over `PrismaClient` rather than a method on a Nest service, because it runs
 * from two places: the institution service, and Better Auth's `session.create.after` hook, which
 * is built inside `AuthModule`'s factory and has no injector to reach a service through.
 *
 * It runs at **sign-in**, not at account creation, which matters: a student may already have a
 * free-trial account when their department buys seats, and an invitation that only worked for new
 * accounts would silently skip everyone who had already tried the product.
 */

import type { PrismaClient } from '@prisma/client';

export type ClaimResult = { institutionId: string; email: string } | null;

export async function claimInstitutionInvite(
  prisma: PrismaClient,
  userId: string,
  rawEmail: string,
): Promise<ClaimResult> {
  const email = rawEmail.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { institutionId: true },
  });
  // Already on a roll: a second institution's invitation does not move them, and this is the
  // common case on every sign-in, so it is the first and cheapest thing checked.
  if (!user || user.institutionId) return null;

  const invite = await prisma.institutionInvite.findFirst({
    where: { email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!invite) return null;

  await prisma.$transaction([
    prisma.institutionInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date(), acceptedById: userId },
    }),
    // §11.3: the seat plan's caps apply from this moment, which is the whole point of counting
    // seats — an unclaimed invitation must never leave someone on a plan nobody is paying for.
    prisma.user.update({
      where: { id: userId },
      data: { institutionId: invite.institutionId, plan: 'INSTITUTION_SEAT' },
    }),
    prisma.auditEvent.create({
      data: {
        kind: 'INSTITUTION_SEAT_TAKEN',
        userId,
        detail: { institutionId: invite.institutionId, email },
      },
    }),
  ]);

  return { institutionId: invite.institutionId, email };
}
