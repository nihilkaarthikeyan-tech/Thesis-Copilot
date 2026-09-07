/**
 * Institution admin — PRD FR-9.6, §11.3 `INSTITUTION_SEAT`, ADR-0009; PHASES v2 B4.1.
 *
 * The seat arithmetic is what this file is for. A seat that is not counted is a capped plan nobody
 * paid for, and the count has to include invitations, because an invitation goes to an address
 * with no account: without holding the seat, an institution with three seats can invite thirty
 * people and find out at the fourth acceptance.
 *
 * The other thing asserted throughout is what the roll does **not** carry. A department paying for
 * seats has a real interest in whether they are used and none at all in what a student is writing
 * (§12.2), so the usage view returns counts and dates and never a title.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimInstitutionInvite } from '../src/modules/institution/claim-invite.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let institutionId: string;
let adminCookie: string;

/**
 * A request built here rather than through `h.api`, for two reasons the harness cannot know
 * about: a sign-in must not carry the harness's own session cookie, and a bodiless request must
 * not carry `content-type: application/json` — Fastify refuses an empty body under that header,
 * which is how a DELETE turns into a 400 that looks like a validation failure.
 */
function call(cookie: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${h.baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      origin: 'http://localhost:3000',
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
}

/**
 * Signs an address in through the real OTP flow, once.
 *
 * Cached because §12.1 allows twenty sign-in attempts a minute per IP, and this file needs more
 * accounts than that if every `signIn` is a fresh round trip. Re-using the session is also what a
 * browser does.
 */
const sessions = new Map<string, { cookie: string; userId: string }>();

async function signIn(email: string): Promise<{ cookie: string; userId: string }> {
  const cached = sessions.get(email);
  if (cached) return cached;
  await call(null, '/auth/email-otp/send-verification-otp', {
    method: 'POST',
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  const { otp } = (await (
    await call(null, `/auth/dev/last-otp?email=${encodeURIComponent(email)}`)
  ).json()) as { otp: string };
  const signedIn = await call(null, '/auth/sign-in/email-otp', {
    method: 'POST',
    body: JSON.stringify({ email, otp }),
  });
  expect(signedIn.status, `sign-in for ${email}`).toBe(200);
  const cookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  expect(cookie, `no session cookie for ${email}`).toContain('better-auth.session_token');
  const user = await h.prisma.user.findUniqueOrThrow({
    where: { email: email.toLowerCase() },
    select: { id: true },
  });
  const session = { cookie, userId: user.id };
  sessions.set(email, session);
  return session;
}

const as = (cookie: string) => (path: string, init?: RequestInit) => call(cookie, path, init);

const seats = (body: unknown) => (body as { seats: Record<string, number> }).seats;

beforeAll(async () => {
  h = await startHarness('inst-superadmin@example.com');
  await h.prisma.user.update({ where: { id: h.userId }, data: { role: 'SUPERADMIN' } });

  const created = await h.api('/admin/institutions', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Example Institute of Technology — Mechanical',
      seats: 3,
      adminEmail: 'dean@example.ac.in',
      seatPriceInr: 220,
      billingPeriod: 'yearly',
    }),
  });
  expect(created.status).toBe(201);
  institutionId = ((await created.json()) as { id: string }).id;
  adminCookie = (await signIn('dean@example.ac.in')).cookie;
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe('creating an institution', () => {
  it('records the negotiated rate rather than a plan price', () => {
    // §11.6 prices a seat at "₹200–250 negotiated", so `PRICING.INSTITUTION_SEAT` is ₹0 and the
    // agreed number lives on the row (ADR-0009).
    return expect(
      h.prisma.institution.findUniqueOrThrow({ where: { id: institutionId } }),
    ).resolves.toMatchObject({ seats: 3, seatPriceInr: 220, billingPeriod: 'yearly' });
  });

  it('promotes an existing account rather than creating a second on the same address', async () => {
    const before = await signIn('already-a-student@example.ac.in');
    const created = await h.api('/admin/institutions', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Second Institute',
        seats: 1,
        adminEmail: 'already-a-student@example.ac.in',
        seatPriceInr: 200,
      }),
    });
    expect(created.status).toBe(201);
    const rows = await h.prisma.user.findMany({
      where: { email: 'already-a-student@example.ac.in' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(before.userId);
    expect(rows[0]?.role).toBe('INSTITUTION_ADMIN');
  });

  it('writes an audit row naming what was agreed', async () => {
    const event = await h.prisma.auditEvent.findFirst({
      where: { kind: 'INSTITUTION_CREATED' },
      orderBy: { createdAt: 'asc' },
    });
    expect(event?.actorId).toBe(h.userId);
    expect(event?.detail).toMatchObject({ seats: 3, seatPriceInr: 220 });
  });

  it('is SUPERADMIN only', async () => {
    const { cookie } = await signIn('outsider@example.com');
    const refused = await as(cookie)('/admin/institutions', {
      method: 'POST',
      body: JSON.stringify({ name: 'Mine', seats: 1, adminEmail: 'x@y.com' }),
    });
    expect(refused.status).toBe(403);
  });
});

describe('the seat count', () => {
  it('starts with every seat free', async () => {
    const body = await (await as(adminCookie)('/institutions/me')).json();
    expect(seats(body)).toEqual({
      total: 3,
      members: 0,
      pendingInvites: 0,
      used: 0,
      free: 3,
    });
  });

  it('an invitation holds a seat before anyone has an account', async () => {
    const response = await as(adminCookie)('/institutions/me/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'student1@example.ac.in' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { seats: Record<string, number> };
    expect(body.seats).toMatchObject({ members: 0, pendingInvites: 1, used: 1, free: 2 });
  });

  it('refuses the invitation that would exceed the count, with the numbers in the message', async () => {
    for (const email of ['student2@example.ac.in', 'student3@example.ac.in']) {
      const ok = await as(adminCookie)('/institutions/me/invites', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      expect(ok.status).toBe(200);
    }
    const over = await as(adminCookie)('/institutions/me/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'student4@example.ac.in' }),
    });
    expect(over.status).toBe(400);
    const problem = (await over.json()) as { detail: string };
    // An admin who has to guess how many seats are left will guess wrong.
    expect(problem.detail).toContain('All 3 seats');
    expect(problem.detail).toContain('3 invitations');
  });

  it('re-inviting an address that already holds a seat extends it rather than taking a second', async () => {
    const again = await as(adminCookie)('/institutions/me/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'student1@example.ac.in' }),
    });
    expect(again.status).toBe(200);
    expect(seats(await again.json())).toMatchObject({ used: 3, free: 0 });
  });

  it('revoking an invitation frees its seat', async () => {
    const invites = (await (await as(adminCookie)('/institutions/me/invites')).json()) as Array<{
      id: string;
      email: string;
      status: string;
    }>;
    const target = invites.find((i) => i.email === 'student3@example.ac.in');
    const revoked = await as(adminCookie)(`/institutions/me/invites/${target?.id}`, {
      method: 'DELETE',
    });
    expect(revoked.status).toBe(200);
    expect(seats(await revoked.json())).toMatchObject({ pendingInvites: 2, used: 2, free: 1 });
  });

  it('an expired invitation stops holding its seat without anyone doing anything', async () => {
    await h.prisma.institutionInvite.updateMany({
      where: { institutionId, email: 'student2@example.ac.in' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const body = await (await as(adminCookie)('/institutions/me')).json();
    expect(seats(body)).toMatchObject({ pendingInvites: 1, free: 2 });
    const invites = (await (await as(adminCookie)('/institutions/me/invites')).json()) as Array<{
      email: string;
      status: string;
    }>;
    expect(invites.find((i) => i.email === 'student2@example.ac.in')?.status).toBe('EXPIRED');
  });

  it('refuses to invite someone already on the roll', async () => {
    await signIn('student1@example.ac.in'); // claims the invitation
    const again = await as(adminCookie)('/institutions/me/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'student1@example.ac.in' }),
    });
    expect(again.status).toBe(400);
    expect(((await again.json()) as { detail: string }).detail).toContain('already on');
  });
});

describe('taking a seat at sign-in', () => {
  it('moves the account onto the seat plan and its institution', async () => {
    const user = await h.prisma.user.findUniqueOrThrow({
      where: { email: 'student1@example.ac.in' },
    });
    expect(user.institutionId).toBe(institutionId);
    expect(user.plan).toBe('INSTITUTION_SEAT');
  });

  it('counts as a member rather than a pending invitation', async () => {
    const body = await (await as(adminCookie)('/institutions/me')).json();
    expect(seats(body)).toMatchObject({ members: 1, pendingInvites: 0 });
  });

  it('works for an account that already existed — the common case once a department buys in', async () => {
    // The claim runs at sign-in rather than at account creation for exactly this reason: a
    // student who tried the free trial before their department bought seats must still be able
    // to take one.
    const existing = await signIn('early-adopter@example.ac.in');
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: existing.userId } })).plan).toBe(
      'FREE_TRIAL',
    );

    await h.prisma.institutionInvite.create({
      data: {
        institutionId,
        email: 'early-adopter@example.ac.in',
        invitedById: h.userId,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const claimed = await claimInstitutionInvite(
      h.prisma,
      existing.userId,
      'early-adopter@example.ac.in',
    );
    expect(claimed?.institutionId).toBe(institutionId);
    const after = await h.prisma.user.findUniqueOrThrow({ where: { id: existing.userId } });
    expect(after.plan).toBe('INSTITUTION_SEAT');
  });

  it('does not move someone who is already on another institution roll', async () => {
    const already = await h.prisma.user.findUniqueOrThrow({
      where: { email: 'student1@example.ac.in' },
    });
    await h.prisma.institutionInvite.create({
      data: {
        institutionId,
        email: 'student1-elsewhere@example.ac.in',
        invitedById: h.userId,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const claimed = await claimInstitutionInvite(
      h.prisma,
      already.id,
      'student1-elsewhere@example.ac.in',
    );
    expect(claimed).toBe(null);
  });

  it('does nothing at all for an address with no invitation', async () => {
    const nobody = await signIn('unaffiliated@example.com');
    const user = await h.prisma.user.findUniqueOrThrow({ where: { id: nobody.userId } });
    expect(user.institutionId).toBe(null);
    expect(user.plan).toBe('FREE_TRIAL');
  });
});

describe('the roll', () => {
  it('reports usage and cost, and no thesis content whatsoever', async () => {
    const student = await h.prisma.user.findUniqueOrThrow({
      where: { email: 'student1@example.ac.in' },
    });
    await h.prisma.document.create({
      data: {
        ownerId: student.id,
        title: 'A title the department must never see',
        entryPath: 'A_TOPIC',
        memory: { create: { scope: {}, outline: [], glossary: {} } },
      },
    });

    const rows = (await (await as(adminCookie)('/institutions/me/usage')).json()) as Array<
      Record<string, unknown>
    >;
    const row = rows.find((r) => r.email === 'student1@example.ac.in');
    expect(row?.documents).toBe(1);
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'costInr',
      'documents',
      'email',
      'id',
      'joinedAt',
      'lastActiveAt',
      'name',
      'plan',
      'usage',
    ]);
    expect(JSON.stringify(rows)).not.toContain('A title the department must never see');
  });

  it('is refused to the students on it', async () => {
    const { cookie } = await signIn('student1@example.ac.in');
    expect((await as(cookie)('/institutions/me/usage')).status).toBe(403);
    expect((await as(cookie)('/institutions/me')).status).toBe(403);
  });

  it('is a 404 for an account with no institution, not a 403', async () => {
    // "There is no institution here" and "you may not look at this one" are different facts.
    const { cookie } = await signIn('outsider@example.com');
    expect((await as(cookie)('/institutions/me')).status).toBe(404);
  });

  it('removing a member frees the seat and leaves their theses alone', async () => {
    const student = await h.prisma.user.findUniqueOrThrow({
      where: { email: 'student1@example.ac.in' },
    });
    const before = await h.prisma.document.count({ where: { ownerId: student.id } });
    const removed = await as(adminCookie)(`/institutions/me/students/${student.id}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);

    const after = await h.prisma.user.findUniqueOrThrow({ where: { id: student.id } });
    expect(after.institutionId).toBe(null);
    // The work is theirs; a seat ending does not take it away (§12.2).
    expect(after.plan).toBe('FREE_TRIAL');
    expect(await h.prisma.document.count({ where: { ownerId: student.id } })).toBe(before);
  });

  it('will not remove the administrator by mistake', async () => {
    const admin = await h.prisma.user.findUniqueOrThrow({
      where: { email: 'dean@example.ac.in' },
    });
    const refused = await as(adminCookie)(`/institutions/me/students/${admin.id}`, {
      method: 'DELETE',
    });
    expect(refused.status).toBe(400);
  });
});

describe('the default template', () => {
  it('lands on a thesis started inside the institution', async () => {
    const template = await h.prisma.institutionTemplate.create({
      data: { name: 'EXAMPLE_IN_UNIVERSITY', spec: {} },
    });
    const saved = await as(adminCookie)('/institutions/me/template', {
      method: 'PUT',
      body: JSON.stringify({ templateId: template.id }),
    });
    expect(saved.status).toBe(200);

    // `unaffiliated@example.com` signed in earlier with no invitation waiting; giving it one now
    // and claiming it is the same path a real student takes, without a further sign-in — §12.1
    // allows twenty a minute and this file is already near it.
    const unaffiliated = await signIn('unaffiliated@example.com');
    await h.prisma.institutionInvite.create({
      data: {
        institutionId,
        email: 'unaffiliated@example.com',
        invitedById: h.userId,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await claimInstitutionInvite(h.prisma, unaffiliated.userId, 'unaffiliated@example.com');
    const created = await as(unaffiliated.cookie)('/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'A seat thesis', entryPath: 'A_TOPIC' }),
    });
    const { id } = (await created.json()) as { id: string };
    const document = await h.prisma.document.findUniqueOrThrow({ where: { id } });
    // A student should never have to know which template their department uses.
    expect(document.institutionTemplateId).toBe(template.id);
  });

  it('can be cleared back to letting students pick', async () => {
    const cleared = await as(adminCookie)('/institutions/me/template', {
      method: 'PUT',
      body: JSON.stringify({ templateId: null }),
    });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { template: unknown }).template).toBe(null);
  });

  it('refuses a template that does not exist', async () => {
    const refused = await as(adminCookie)('/institutions/me/template', {
      method: 'PUT',
      body: JSON.stringify({ templateId: '00000000-0000-7000-8000-000000000000' }),
    });
    expect(refused.status).toBe(404);
  });
});

describe('the invoice', () => {
  it('is seats times the agreed rate, for the period asked for', async () => {
    const year = String(new Date().getUTCFullYear());
    const response = await as(adminCookie)(`/institutions/me/invoices/${year}`);
    expect(response.status).toBe(200);
    const invoice = (await response.json()) as {
      period: string;
      seats: number;
      seatPriceInr: number;
      totalInr: number;
      billedTo: string;
    };
    expect(invoice.period).toBe(year);
    expect(invoice.seatPriceInr).toBe(220);
    expect(invoice.totalInr).toBe(invoice.seats * 220);
    expect(invoice.billedTo).toBe('dean@example.ac.in');
  });

  it('refuses a month against a yearly agreement, saying which it wants', async () => {
    const refused = await as(adminCookie)('/institutions/me/invoices/2026-09');
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { detail: string }).detail).toContain('per year');
  });

  it('says so rather than guessing when no rate was ever agreed', async () => {
    // §0.3 rule 4: a plausible wrong number on an invoice is worse than an admission.
    await h.prisma.institution.update({
      where: { id: institutionId },
      data: { seatPriceInr: 0 },
    });
    const invoice = (await (
      await as(adminCookie)(`/institutions/me/invoices/${new Date().getUTCFullYear()}`)
    ).json()) as { totalInr: number; seatPriceInr: number };
    expect(invoice.seatPriceInr).toBe(0);
    expect(invoice.totalInr).toBe(0);
    await h.prisma.institution.update({
      where: { id: institutionId },
      data: { seatPriceInr: 220 },
    });
  });
});
