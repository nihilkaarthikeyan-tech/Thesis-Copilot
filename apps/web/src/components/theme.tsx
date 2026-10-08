'use client';

import { type FontStyle, readFontStyle } from '@tc/types';
import { BookOpen, Monitor, Moon, MoonStar, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Colour theme, per docs/DESIGN.md — one button that cycles Light → Dark → System.
 *
 * It was a two-way segmented control ("Light | Dark") until 2026-09-21. One button that cycles is
 * what the owner asked for and it is also the better control here, for a reason worth writing
 * down: the old pair could not express **System**, even though the CSS has always had three
 * states and an un-chosen visitor has always been in the third one. The segmented control showed
 * such a visitor "Light" — a lie the moment they moved to a dark OS — and once either button was
 * pressed there was no way back to following the device short of clearing site data.
 *
 * So the third state is not decoration. It is the default every visitor arrives in, it was
 * previously unreachable and unnameable, and a cycle gives it a home at no extra width.
 *
 * The choice is per-browser and lives in `localStorage`, deliberately not on the server: a student
 * writing at night on a laptop and reviewing on a library machine in the morning wants each device
 * to keep its own answer.
 */

/**
 * `system` means "no choice stamped" — `prefers-color-scheme` in `globals.css` decides. The two
 * paper themes (R33, ADR-0120) are chosen in Settings; the button below shows them but its cycle
 * stays light, dark, system.
 */
export type Theme = 'light' | 'dark' | 'system' | 'paper-light' | 'paper-dark';

/** Every theme, in the order Settings lists them. */
export const THEMES: readonly Theme[] = ['system', 'light', 'dark', 'paper-light', 'paper-dark'];

const KEY = 'tc-theme';
/** High contrast is its own switch (2026-10-04): it combines with light, dark and system. */
const CONTRAST_KEY = 'tc-contrast';
/**
 * R33 (ADR-0120): the font style is the account's (`User.settings.fontStyle`), kept here too so a
 * page opens in it before the settings arrive, with no flash of the other typeface.
 */
const FONT_KEY = 'tc-font-style';

/** The cycle. Light and dark first, because those are the two anyone is actually reaching for. */
const ORDER: readonly Theme[] = ['light', 'dark', 'system'];

const STAMPED: readonly Theme[] = ['light', 'dark', 'paper-light', 'paper-dark'];
const isStamped = (value: string | null): value is Theme =>
  value !== null && (STAMPED as readonly string[]).includes(value);

/**
 * Applies the stored choice before first paint.
 *
 * Inline and synchronous on purpose. Reading `localStorage` from an effect would paint the light
 * theme first and then repaint dark, which is the flash every themed app has to design around.
 */
export function ThemeScript() {
  const js = `(function(){try{var d=document.documentElement;var t=localStorage.getItem('${KEY}');if(t==='dark'||t==='light'||t==='paper-light'||t==='paper-dark'){d.setAttribute('data-theme',t)}if(localStorage.getItem('${CONTRAST_KEY}')==='high'){d.setAttribute('data-contrast','high')}var f=localStorage.getItem('${FONT_KEY}');if(f==='serif'||f==='sans'){d.setAttribute('data-font-style',f)}}catch(e){}})()`;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed literal, no interpolated input.
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}

export function useTheme(): [Theme, (next: Theme) => void] {
  // `system` until the browser tells us otherwise: it is both the true default and what the server
  // renders, so first paint matches and there is no hydration mismatch.
  const [theme, setThemeState] = useState<Theme>('system');

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      // Site data blocked. The device preference still applies for this page view.
    }
    if (isStamped(stored)) setThemeState(stored);
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    if (next === 'system') {
      // Removing the attribute is what hands control back to the media query. Setting
      // `data-theme="system"` would match neither CSS block and render an unstyled root.
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', next);
    }
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // The choice holds for this page view even when it cannot be stored.
    }
  };

  return [theme, setTheme];
}

export const FACES: Record<Theme, { Icon: typeof Sun; label: string }> = {
  light: { Icon: Sun, label: 'Light' },
  dark: { Icon: Moon, label: 'Dark' },
  system: { Icon: Monitor, label: 'System' },
  'paper-light': { Icon: BookOpen, label: 'Paper light' },
  'paper-dark': { Icon: MoonStar, label: 'Paper dark' },
};

/**
 * One button. Click it and the theme moves on one step.
 *
 * All three icons are rendered and only one is visible, rather than swapping a single element's
 * icon. Swapping would mount a new node on every click, and a node that has just mounted cannot
 * animate *from* anywhere — the transition would only ever play on the way out. Keeping all three
 * mounted and moving them means both the outgoing and incoming icons are real elements that can
 * be tweened past each other.
 *
 * The button announces the state it is *in* and the description says what pressing does, because
 * a control labelled with its next state reads as its current one to a screen reader and gets the
 * answer exactly backwards.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? 'light';

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Colour theme: ${FACES[theme].label}. Switch to ${FACES[next].label}.`}
      title={`${FACES[theme].label} — click for ${FACES[next].label}`}
      className={cn(
        'group relative inline-flex size-7 shrink-0 items-center justify-center overflow-hidden',
        'rounded-md border border-line bg-surface text-muted',
        'transition-colors hover:border-line-strong hover:bg-sunk hover:text-ink',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        className,
      )}
    >
      {THEMES.map((option) => {
        const { Icon, label } = FACES[option];
        const active = theme === option;
        return (
          <Icon
            key={option}
            aria-hidden="true"
            data-face={label}
            strokeWidth={1.75}
            className={cn(
              'absolute size-[15px] transition-all duration-300 ease-out',
              // Out goes up and away, in arrives from below: a single direction of travel reads
              // as one control advancing rather than two icons crossfading at random.
              active
                ? 'translate-y-0 rotate-0 scale-100 opacity-100'
                : 'pointer-events-none translate-y-3 -rotate-90 scale-50 opacity-0',
            )}
          />
        );
      })}
    </button>
  );
}

/**
 * High contrast on or off (2026-10-04, from the Jenni study). Per browser, like the theme, and
 * applied before first paint by `ThemeScript`. Darker muted text and stronger lines; the tokens
 * are in `globals.css` under `data-contrast="high"`.
 */
export function useHighContrast(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(document.documentElement.getAttribute('data-contrast') === 'high');
  }, []);
  const set = (next: boolean) => {
    setOn(next);
    if (next) document.documentElement.setAttribute('data-contrast', 'high');
    else document.documentElement.removeAttribute('data-contrast');
    try {
      if (next) localStorage.setItem(CONTRAST_KEY, 'high');
      else localStorage.removeItem(CONTRAST_KEY);
    } catch {
      // Holds for this page view even when it cannot be stored.
    }
  };
  return [on, set];
}

/**
 * The thesis text's font style (R33, ADR-0120) on this page: `data-font-style` on <html>, which
 * `editor.css` reads, and the copy in `localStorage` that `ThemeScript` applies before first paint.
 * The account keeps the choice (`PUT /settings`); this only draws it.
 */
export function applyFontStyle(value: unknown): FontStyle {
  const style = readFontStyle(value);
  if (typeof document !== 'undefined') {
    if (style === 'default') document.documentElement.removeAttribute('data-font-style');
    else document.documentElement.setAttribute('data-font-style', style);
  }
  try {
    if (style === 'default') localStorage.removeItem(FONT_KEY);
    else localStorage.setItem(FONT_KEY, style);
  } catch {
    // Holds for this page view even when it cannot be stored.
  }
  return style;
}
