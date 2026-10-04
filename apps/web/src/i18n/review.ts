/**
 * The review sheet for a translation (ADR-0061): every translated interface string beside its
 * English source, as Markdown, for a native speaker to check. `test/i18n-review.spec.ts` keeps
 * docs/i18n/hi-review.md equal to this, so the sheet can never drift from the catalogue.
 */

import { en, type MessageKey } from './en';

const SECTIONS: Record<string, string> = {
  common: 'Shared words',
  list: 'The thesis list',
  new: 'New thesis',
  style: 'Starting citation style',
  proposal: 'The proposal screen',
  pathA: 'The topic conversation (proposal)',
  editor: 'The editor',
  fmt: 'The formatting toolbar (tooltips)',
  suggest: 'The suggestion bar',
  command: 'The selection toolbar',
  settings: 'Settings',
  account: 'Account',
  trial: 'The free-trial notice',
  signin: 'Sign in',
};

const cell = (text: string) => text.replaceAll('|', '\\|');

export function reviewSheet(
  languageName: string,
  catalogue: Partial<Record<MessageKey, string>>,
): string {
  const keys = Object.keys(en) as MessageKey[];
  const translated = keys.filter((key) => catalogue[key] !== undefined);
  const untranslated = keys.filter((key) => catalogue[key] === undefined);

  const lines: string[] = [
    `# ${languageName} interface strings — for review`,
    '',
    'Generated from `apps/web/src/i18n/` (ADR-0061). Do not edit by hand: correct the catalogue,',
    'then run `UPDATE_I18N_REVIEW=1 pnpm --filter @tc/web test` to rewrite this file.',
    '',
    `**${translated.length}** strings are translated; **${untranslated.length}** are deliberately`,
    'left in English (listed at the end). The language stays marked “(बीटा)” until a native speaker',
    'has read every row below (docs/PENDING.md).',
    '',
    'What to check, row by row: is it natural, simple language an Indian PhD student would expect?',
    'Are the academic words the ones universities actually use (थीसिस or शोध-प्रबंध, साइटेशन or',
    'उद्धरण)? Does a button read as an action? `{name}` placeholders must stay exactly as written,',
    'and product names (Assist, Draft, Thesis Copilot, APA 7, Word, Google, Razorpay) stay in',
    'English. Write corrections in the last column.',
    '',
  ];

  let section = '';
  for (const key of translated) {
    const prefix = key.split('.')[0] ?? '';
    if (prefix !== section) {
      section = prefix;
      lines.push(
        `## ${SECTIONS[prefix] ?? prefix}`,
        '',
        `| Key | English | ${languageName} | Correction |`,
        '|---|---|---|---|',
      );
    }
    lines.push(`| \`${key}\` | ${cell(en[key])} | ${cell(catalogue[key] ?? '')} | |`);
    // A blank line closes the table before the next heading.
    const next = translated[translated.indexOf(key) + 1];
    if (!next || next.split('.')[0] !== prefix) lines.push('');
  }

  lines.push('## Left in English on purpose', '');
  for (const key of untranslated) lines.push(`- \`${key}\` — ${en[key]}`);
  lines.push('');
  return lines.join('\n');
}
