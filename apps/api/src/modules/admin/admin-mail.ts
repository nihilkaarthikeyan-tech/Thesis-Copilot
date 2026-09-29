/**
 * What a student is told when an administrator acts on their work (2026-09-29).
 *
 * The owner chose open access over none: an administrator may read a thesis, never change it,
 * every read is logged, and the student hears about it straight away. These are those emails, in
 * the words the owner approved. Plain text, like every other mail the product sends.
 */

import type { Mail } from '../../common/mailer.js';

/** "today at 11:02 IST" — students are in India, and a UTC time in an email reads as wrong. */
export function istTime(at: Date): string {
  return `${at.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })} IST`;
}

function greeting(name: string | null): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : 'Hello,';
}

export function thesisViewedMail(input: {
  to: string;
  name: string | null;
  title: string;
  at: Date;
  appUrl: string;
}): Mail {
  return {
    to: [input.to],
    subject: 'An administrator viewed your thesis',
    text: [
      greeting(input.name),
      '',
      `An administrator of Thesis Copilot opened your thesis “${input.title}” to read it, on ${istTime(input.at)}. They cannot change anything in it.`,
      '',
      'This happens rarely, for support or to prevent misuse, and every visit is recorded. If you did ' +
        `not expect it, write to us through ${input.appUrl}/contact and we will tell you why.`,
      '',
      `Thesis Copilot · ${input.appUrl.replace(/^https?:\/\//, '')}`,
    ].join('\n'),
  };
}

export function thesisDeletedMail(input: {
  to: string;
  name: string | null;
  title: string;
  reason: string;
  appUrl: string;
}): Mail {
  return {
    to: [input.to],
    subject: 'An administrator deleted one of your theses',
    text: [
      greeting(input.name),
      '',
      `An administrator of Thesis Copilot deleted your thesis “${input.title}”, with its chapters, ` +
        'sources and files.',
      '',
      `The reason they gave: ${input.reason}`,
      '',
      `If you think this was a mistake, write to us through ${input.appUrl}/contact.`,
      '',
      `Thesis Copilot · ${input.appUrl.replace(/^https?:\/\//, '')}`,
    ].join('\n'),
  };
}

/**
 * The one-off notice to existing students about the change above. Sent by
 * `pnpm --filter @tc/api privacy:notice --send`, and only once the owner has approved the text.
 */
export function privacyNoticeMail(input: {
  to: string;
  name: string | null;
  appUrl: string;
}): Mail {
  return {
    to: [input.to],
    subject: 'A change to how we handle your thesis',
    text: [
      greeting(input.name),
      '',
      'We have updated our privacy notice. Administrators can now open a thesis to read it, only ' +
        'for support or to prevent misuse, never to change it. You will get an email every time ' +
        'this happens.',
      '',
      `Read the full notice at ${input.appUrl}/privacy.`,
      '',
      `Thesis Copilot · ${input.appUrl.replace(/^https?:\/\//, '')}`,
    ].join('\n'),
  };
}
