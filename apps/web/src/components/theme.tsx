'use client';

import { useEffect, useId, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Light or dark, per docs/DESIGN.md.
 *
 * The control offers two states. A first visit still follows the device — nothing is stamped on the
 * root element until someone chooses, so `prefers-color-scheme` in `globals.css` decides, and the
 * toggle shows whichever of the two that resolved to. From the first click on it is an explicit
 * choice, stamped as `data-theme` and beating the media query in both directions.
 *
 * (The CSS keeps all three cases because the un-stamped state is real and has to render; what was
 * removed is the third *button*, not the third behaviour.)
 *
 * The choice is per-browser and lives in `localStorage`. It is deliberately not a user setting on
 * the server: a student writing at night on their laptop and reviewing on a library machine in the
 * morning wants each device to keep its own answer.
 */

export type Theme = 'light' | 'dark';

const KEY = 'tc-theme';

/**
 * Applies the stored choice before first paint.
 *
 * Inline and synchronous on purpose. Reading `localStorage` from an effect would paint the light
 * theme first and then repaint dark, which is the flash every themed app has to design around.
 */
export function ThemeScript() {
  const js = `(function(){try{var t=localStorage.getItem('${KEY}');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed literal, no interpolated input.
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}

export function useTheme(): [Theme, (next: Theme) => void] {
  // Light until the browser tells us otherwise. The effect below corrects it on mount; rendering
  // 'light' first matches the server, so there is no hydration mismatch.
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      // Site data blocked. The device preference below still applies for this page view.
    }
    if (stored === 'dark' || stored === 'light') {
      setThemeState(stored);
      return;
    }
    // Nothing chosen yet: show what the device resolved to, without stamping it. The page is
    // already rendering that theme via `prefers-color-scheme`; this only makes the toggle agree.
    setThemeState(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // The choice holds for this page view even when it cannot be stored.
    }
  };

  return [theme, setTheme];
}

const OPTIONS: ReadonlyArray<{ value: Theme; label: string; title: string }> = [
  { value: 'light', label: 'Light', title: 'Light theme' },
  { value: 'dark', label: 'Dark', title: 'Dark theme' },
];

/**
 * A two-way segmented control. Small enough for a top bar, explicit enough to need no legend.
 *
 * Built from real radio inputs rather than buttons carrying `role="radio"`: a native radio group
 * already gives arrow-key navigation and a correct announcement, and the visible control is the
 * label, so nothing has to be reimplemented.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const name = useId();

  return (
    <fieldset
      className={cn(
        'inline-flex items-center gap-0 rounded-md border border-line bg-surface p-0.5',
        className,
      )}
    >
      <legend className="sr-only">Colour theme</legend>
      {OPTIONS.map((option) => {
        const active = theme === option.value;
        return (
          <label
            key={option.value}
            title={option.title}
            className={cn(
              'cursor-pointer rounded-sm px-2 py-0.5 text-[11px] font-semibold transition-colors',
              'focus-within:outline focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent',
              active ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              onChange={() => setTheme(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </fieldset>
  );
}
