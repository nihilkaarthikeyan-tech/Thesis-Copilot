'use client';

import { LANGUAGES } from '@/i18n';
import { useLanguage, useT } from '@/i18n/react';
import { cn } from '@/lib/utils';

/**
 * The interface language on a signed-out page (ADR-0061): one small row, each language named in
 * itself. The choice goes into the cookie, so the screens after sign-in open in it too, and the
 * first signed-in page saves it to the account.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { t } = useT();
  const [language, setLanguage] = useLanguage();
  return (
    <fieldset
      className={cn('flex flex-wrap items-center gap-2 border-0 p-0 text-[12.5px]', className)}
      data-testid="language-switcher"
    >
      <legend className="sr-only">{t('signin.language')}</legend>
      {LANGUAGES.map((option, index) => (
        <span key={option.id} className="inline-flex items-center gap-2">
          {index > 0 ? (
            <span aria-hidden="true" className="text-faint">
              ·
            </span>
          ) : null}
          <button
            type="button"
            lang={option.id}
            aria-pressed={language === option.id}
            onClick={() => setLanguage(option.id)}
            className={cn(
              'underline-offset-2 hover:text-ink',
              language === option.id ? 'font-semibold text-ink' : 'text-muted underline',
            )}
          >
            {option.name}
          </button>
        </span>
      ))}
    </fieldset>
  );
}
