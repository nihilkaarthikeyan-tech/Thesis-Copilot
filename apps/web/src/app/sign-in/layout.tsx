import type { ReactNode } from 'react';
import { LanguageAttribute, LanguageProvider } from '@/i18n/react';
import { requestLanguage } from '@/i18n/server';

/** Sign-in in the language picked on it, or on this browser before (ADR-0061). */
export default async function SignInLayout({ children }: { children: ReactNode }) {
  const language = await requestLanguage();
  return (
    <LanguageProvider initial={language}>
      <LanguageAttribute language={language} />
      {children}
    </LanguageProvider>
  );
}
