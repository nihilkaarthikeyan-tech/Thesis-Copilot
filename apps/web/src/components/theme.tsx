'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
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

/** `system` means "no choice stamped" — `prefers-color-scheme` in `globals.css` decides. */
export type Theme = 'light' | 'dark' | 'system';

const KEY = 'tc-theme';
/** High contrast is its own switch (2026-10-04): it combines with light, dark and system. */
const CONTRAST_KEY = 'tc-contrast';

/** The cycle. Light and dark first, because those are the two anyone is actually reaching for. */
const ORDER: readonly Theme[] = ['light', 'dark', 'system'];

/**
 * Applies the stored choice before first paint.
 *
 * Inline and synchronous on purpose. Reading `localStorage` from an effect would paint the light
 * theme first and then repaint dark, which is the flash every themed app has to design around.
 */
export function ThemeScript() {
  const js = `(function(){try{var t=localStorage.getItem('${KEY}');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}if(localStorage.getItem('${CONTRAST_KEY}')==='high'){document.documentElement.setAttribute('data-contrast','high')}}catch(e){}})()`;
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
    if (stored === 'dark' || stored === 'light') setThemeState(stored);
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

const FACES: Record<Theme, { Icon: typeof Sun; label: string }> = {
  light: { Icon: Sun, label: 'Light' },
  dark: { Icon: Moon, label: 'Dark' },
  system: { Icon: Monitor, label: 'System' },
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
      {ORDER.map((option) => {
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
