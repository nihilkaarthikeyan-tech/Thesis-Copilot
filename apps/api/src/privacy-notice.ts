/**
 * The one-off email telling existing students about the change to admin access (2026-09-29).
 *
 * Built into `dist` so it can run inside the production API container:
 *
 *   node apps/api/dist/privacy-notice.js          # dry run: who would get it, and the text
 *   node apps/api/dist/privacy-notice.js --send   # sends it
 *
 * The owner approves the text before anyone runs `--send`. Every account that is not deleted and
 * not an administrator gets it once; each send is logged as PRIVACY_NOTICE_SENT, and an account
 * that already has that row is skipped, so a second run after a failure only finishes the job.
 */

import { loadEnv } from '@tc/config';
import { PrismaClient } from '@tc/db';
import { createMailer } from './common/mailer.js';
import { privacyNoticeMail } from './modules/admin/admin-mail.js';

async function main(): Promise<void> {
  const send = process.argv.includes('--send');
  const env = loadEnv();
  const prisma = new PrismaClient();
  try {
    const already = await prisma.auditEvent.findMany({
      where: { kind: 'PRIVACY_NOTICE_SENT' },
      select: { userId: true },
    });
    const done = new Set(already.map((a) => a.userId));
    const users = (
      await prisma.user.findMany({
        where: { deletedAt: null, role: { not: 'SUPERADMIN' } },
        select: { id: true, email: true, name: true },
        orderBy: { createdAt: 'asc' },
      })
    ).filter((u) => !done.has(u.id));

    const sample = privacyNoticeMail({
      to: 'student@example.com',
      name: null,
      appUrl: env.APP_URL,
    });
    console.log(`Subject: ${sample.subject}\n\n${sample.text}\n`);
    console.log(`${users.length} account(s) to email; ${done.size} already emailed.`);
    if (!send) {
      console.log('Dry run. Nothing was sent. Add --send to send it.');
      return;
    }

    const { mailer } = createMailer(env);
    let sent = 0;
    for (const user of users) {
      try {
        await mailer.send(
          privacyNoticeMail({ to: user.email, name: user.name, appUrl: env.APP_URL }),
        );
        await prisma.auditEvent.create({
          data: { kind: 'PRIVACY_NOTICE_SENT', userId: user.id, detail: {} },
        });
        sent += 1;
      } catch (error) {
        console.error(
          `could not email ${user.id}:`,
          error instanceof Error ? error.message : error,
        );
      }
      // Gentle on the SMTP server: a burst of hundreds reads as spam to the receiving side.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    console.log(`Sent ${sent} of ${users.length}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
