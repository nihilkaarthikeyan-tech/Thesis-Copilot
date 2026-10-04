'use client';

/**
 * The interface language in React (ADR-0061).
 *
 * The choice lives in three places, each for one job:
 *   - the `tc-lang` cookie, so the server renders the first paint in the right language and there
 *     is no English flash before Hindi (the `/app` and `/sign-in` layouts read it);
 *   - localStorage, the same value, in case the cookie is cleared on its own;
 *   - the account's settings (`PUT /settings`, `interfaceLanguage`), so it follows the student to
 *     another device. On the signed-in screens the account's answer wins, once per tab.
 *
 * Outside a provider every hook answers English, so a page that has not been brought in yet
 * renders exactly as it always did.
 */

import {
  createContext,
  Fragment,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '@/lib/api';
import {
  DEFAULT_LANGUAGE,
  isLanguage,
  LANGUAGE_COOKIE,
  type Language,
  type MessageKey,
  setCurrentLanguage,
  splitTemplate,
  template,
  translate,
  type Vars,
} from './index';

/** Set once the account's language has been read in this tab; cleared on the sign-in page. */
const SYNCED_KEY = 'tc-lang-synced';
const YEAR_SECONDS = 60 * 60 * 24 * 365;

type LanguageState = { language: Language; setLanguage: (next: Language) => void };

const LanguageContext = createContext<LanguageState>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => undefined,
});

/** Writes the cookie and the localStorage copy. Never throws: blocked storage only loses memory. */
export function rememberLanguage(language: Language): void {
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: one non-secret preference; the server reads it for first paint.
    document.cookie = `${LANGUAGE_COOKIE}=${language}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`;
  } catch {
    // Cookies off: the language still holds for this page view.
  }
  try {
    localStorage.setItem(LANGUAGE_COOKIE, language);
  } catch {
    // Site data blocked.
  }
}

/** The sign-in page calls this, so the next account to sign in here is asked afresh. */
export function forgetAccountLanguage(): void {
  try {
    sessionStorage.removeItem(SYNCED_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Sets `<html lang>` before paint, for screen readers and for the Devanagari font rule. */
export function LanguageAttribute({ language }: { language: Language }) {
  if (language === DEFAULT_LANGUAGE) return null;
  const js = `document.documentElement.lang=${JSON.stringify(language)}`;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed literal built from a two-value enum.
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}

export function LanguageProvider({
  initial,
  syncWithAccount = false,
  children,
}: {
  initial: Language;
  /** On the signed-in screens: adopt the account's language, or save this one to it. */
  syncWithAccount?: boolean;
  children: ReactNode;
}) {
  const [language, setLanguageState] = useState<Language>(initial);
  // During render as well as in the effect: a callback that fires before any effect has run still
  // has to find the right language in `tNow`.
  setCurrentLanguage(language);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    setCurrentLanguage(next);
    rememberLanguage(next);
  }, []);

  // The latest choice, for the account check below, which runs once and must not re-run on it.
  const languageRef = useRef(language);
  languageRef.current = language;

  useEffect(() => {
    document.documentElement.lang = language;
    setCurrentLanguage(language);
  }, [language]);

  useEffect(
    () => () => {
      // Leaving the translated screens for a page that is English only.
      document.documentElement.lang = DEFAULT_LANGUAGE;
      setCurrentLanguage(DEFAULT_LANGUAGE);
    },
    [],
  );

  // The cookie is missing but this browser remembers a choice: take it, and write the cookie back.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LANGUAGE_COOKIE);
    } catch {
      return;
    }
    if (!document.cookie.includes(`${LANGUAGE_COOKIE}=`) && isLanguage(stored)) {
      setLanguage(stored);
    }
  }, [setLanguage]);

  useEffect(() => {
    if (!syncWithAccount) return;
    try {
      if (sessionStorage.getItem(SYNCED_KEY) === '1') return;
    } catch {
      // No session storage: ask the account every time; one small read.
    }
    let cancelled = false;
    api<{ interfaceLanguage?: unknown }>('/settings')
      .then(async (settings) => {
        if (cancelled) return;
        const language = languageRef.current;
        if (isLanguage(settings.interfaceLanguage)) {
          if (settings.interfaceLanguage !== language) setLanguage(settings.interfaceLanguage);
        } else if (language !== DEFAULT_LANGUAGE) {
          // Chosen on the sign-in page before the account had a say: keep it with the account.
          await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({ interfaceLanguage: language }),
          });
        }
        try {
          sessionStorage.setItem(SYNCED_KEY, '1');
        } catch {
          // As above.
        }
      })
      // Signed out, or the API is down: the cookie's answer stands, and the next page asks again.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [syncWithAccount, setLanguage]);

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): [Language, (next: Language) => void] {
  const { language, setLanguage } = useContext(LanguageContext);
  return [language, setLanguage];
}

/**
 * `t(key, vars)` for text; `rich(key, slots)` when a slot is an element:
 *
 *     rich('editor.hint.keys', { tab: <kbd>Tab</kbd>, esc: <kbd>Esc</kbd> })
 */
export function useT() {
  const { language } = useContext(LanguageContext);
  return useMemo(() => {
    const t = (key: MessageKey, vars?: Vars) => translate(language, key, vars);
    const rich = (key: MessageKey, slots: Record<string, ReactNode>): ReactNode =>
      splitTemplate(template(language, key)).map((part, index) =>
        'text' in part ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string, in order.
          <Fragment key={index}>{part.text}</Fragment>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above.
          <Fragment key={index}>{slots[part.slot] ?? `{${part.slot}}`}</Fragment>
        ),
      );
    return { t, rich, language };
  }, [language]);
}
