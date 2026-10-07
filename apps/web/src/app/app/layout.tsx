import type { ReactNode } from 'react';
import { UsageCorner } from '@/components/UsageMenu';
import { LanguageAttribute, LanguageProvider } from '@/i18n/react';
import { requestLanguage } from '@/i18n/server';

/**
 * The signed-in screens, in the student's interface language (ADR-0061). The cookie gives the
 * first paint; the provider then checks the account's own setting once per tab.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const language = await requestLanguage();
  return (
    <LanguageProvider initial={language} syncWithAccount>
      <LanguageAttribute language={language} />
      {children}
      {/* R12 (ADR-0099): usage one click away on the screens without their own header. */}
      <UsageCorner />
    </LanguageProvider>
  );
}
