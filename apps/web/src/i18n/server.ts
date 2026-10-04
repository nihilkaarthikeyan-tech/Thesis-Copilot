import { cookies } from 'next/headers';
import { LANGUAGE_COOKIE, type Language, parseLanguage } from './index';

/** The interface language for this request, from the cookie the picker writes (ADR-0061). */
export async function requestLanguage(): Promise<Language> {
  const jar = await cookies();
  return parseLanguage(jar.get(LANGUAGE_COOKIE)?.value);
}
