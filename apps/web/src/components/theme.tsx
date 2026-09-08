'use client';

import { useEffect, useId, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Light / dark / system, per docs/DESIGN.md.
 *
 * Three states, not two. "System" is the default and stamps nothing on the root element, so the
 * `prefers-color-scheme` rules in `globals.css` decide; an explicit choice stamps
 * `data-theme="light"` or `"dark"`, which beats the media query in both directions.
 *
 * The choice is per-browser and lives in `localStorage`. It is deliberately not a user setting on
 * the server: a student writing at night on their laptop and reviewing on a library machine in the
 * morning wants each device to keep its own answer.
 */

export type Theme = 'light' | 'dark' | 'system';

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

function apply(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>('system');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored === 'dark' || stored === 'light') setThemeState(stored);
    } catch {
      // A browser with site data blocked still gets the system theme; nothing else depends on it.
    }
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    apply(next);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Same as above: the choice holds for this page view even when it cannot be stored.
    }
  };

  return [theme, setTheme];
}

const OPTIONS: ReadonlyArray<{ value: Theme; label: string; title: string }> = [
  { value: 'light', label: 'Light', title: 'Always light' },
  { value: 'dark', label: 'Dark', title: 'Always dark' },
  { value: 'system', label: 'Auto', title: 'Follow this device' },
];

/**
 * A three-way segmented control. Small enough for a top bar, explicit enough to need no legend.
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
