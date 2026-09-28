/**
 * The Thesis Copilot mark: a T for thesis with a footnote dot where a superscript citation sits
 * (option D, chosen by the owner on 2026-09-28).
 *
 * Drawn on a 64-unit grid so it survives 16px: every stroke is at least 7.5 units (~1.9px at 16px).
 * Colours come from `--logo-*` in globals.css, which invert in dark mode — an ink tile on a dark
 * page would otherwise disappear. The favicon files in `src/app/` are the same drawing.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="64" height="64" rx="15" fill="var(--logo-tile)" />
      <path d="M11 15h30v7.5H29.8V50h-7.6V22.5H11z" fill="var(--logo-glyph)" />
      <circle cx="48" cy="19" r="6" fill="var(--logo-dot)" />
    </svg>
  );
}
