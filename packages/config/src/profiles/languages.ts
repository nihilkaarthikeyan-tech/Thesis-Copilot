/**
 * Language settings — ADR-0039, the specification's §4.2 language note: "for theses written in
 * Tamil, Hindi or other languages, the profile adds a language setting: writing language, script,
 * terminology sheet in that language, and grammar checker. The engine is unchanged."
 *
 * What the setting changes here: every prompt is already told the thesis's language (§2.2); the
 * Latin-only checks (abbreviations at first use, British/American spelling) stand down for a
 * non-Latin script; the proofread pass runs in the language. Terminology sheets in Tamil and Hindi
 * are for the department to fill (a native-speaker review is in docs/PENDING.md).
 */

export type LanguageSetting = {
  readonly id: string;
  readonly label: string;
  readonly script:
    | 'latin'
    | 'tamil'
    | 'devanagari'
    | 'telugu'
    | 'kannada'
    | 'malayalam'
    | 'bengali'
    | 'gujarati'
    | 'other';
  /** The proofread pass can run: the fast model corrects spelling and grammar in this language. */
  readonly proofread: boolean;
};

export const LANGUAGES: readonly LanguageSetting[] = [
  { id: 'en', label: 'English', script: 'latin', proofread: true },
  { id: 'ta', label: 'Tamil (தமிழ்)', script: 'tamil', proofread: true },
  { id: 'hi', label: 'Hindi (हिन्दी)', script: 'devanagari', proofread: true },
  { id: 'te', label: 'Telugu (తెలుగు)', script: 'telugu', proofread: true },
  { id: 'kn', label: 'Kannada (ಕನ್ನಡ)', script: 'kannada', proofread: true },
  { id: 'ml', label: 'Malayalam (മലയാളം)', script: 'malayalam', proofread: true },
  { id: 'mr', label: 'Marathi (मराठी)', script: 'devanagari', proofread: true },
  { id: 'bn', label: 'Bengali (বাংলা)', script: 'bengali', proofread: true },
  { id: 'gu', label: 'Gujarati (ગુજરાતી)', script: 'gujarati', proofread: true },
];

export function languageSetting(tag: string | null | undefined): LanguageSetting {
  const base = (tag ?? 'en').toLowerCase().split(/[-_]/)[0] ?? 'en';
  return (
    LANGUAGES.find((l) => l.id === base) ?? {
      id: base,
      label: base,
      script: 'other',
      proofread: true,
    }
  );
}

/** Whether the checks written for the Latin alphabet (L3, spelling variants) apply. */
export function latinScript(tag: string | null | undefined): boolean {
  return languageSetting(tag).script === 'latin';
}
