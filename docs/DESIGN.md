# Paper & Ink — the Thesis Copilot design system

Status: adopted 2026-09-08. Implemented in `apps/web/src/app/globals.css`,
`apps/web/src/components/ui/primitives.tsx` and `apps/web/src/components/theme.tsx`.

PRD §6 specifies the *structure* of every screen — routes, the three-column editor, the keyboard
map, the accessibility rules — and it is correct and unchanged by this document. What §6 does not
specify is a single colour, typeface or spacing value. This file fills that gap and nothing else.
Where the two ever disagree, the PRD wins.

## The idea

The student is writing a document they will be examined on. The screen's job is to disappear
behind their prose. Two rules follow, and between them they decide almost every question below.

**1. Nothing competes with body text.** One accent colour, spent on actions and citation marks and
almost nowhere else. Separation by hairline, not by shadow. Radii of 3px, because 12px reads as a
consumer app. No gradient, no illustration, no colour used decoratively.

**2. AI output never looks like the student's own writing.** `--ghost` is reserved for text the
model has proposed and the student has not accepted. It appears nowhere else, so its meaning is
never diluted. This is §12.3 — "flag, don't fix" — expressed as a colour.

## Colour

Every value is a CSS variable in `@theme`, so Tailwind's utilities compile to `var(--color-…)`
and a runtime override re-themes the whole app. Never write a literal colour in a component.

| Token | Light | Dark | Use |
|---|---|---|---|
| `paper` | `#F5F6F4` | `#171917` | The page. |
| `surface` | `#FDFDFC` | `#1E211E` | Cards, panels, inputs. |
| `sunk` | `#ECEEE9` | `#121412` | Wells, hover, table stripes. |
| `ink` | `#1C1E1B` | `#E7E9E4` | Body text and headings. |
| `muted` | `#666B63` | `#9BA098` | Secondary prose, labels. |
| `faint` | `#979C93` | `#6E736B` | Eyebrows, timestamps, captions. |
| `line` | `#DFE2DB` | `#2C302B` | Default hairline. |
| `line-strong` | `#C9CEC3` | `#3D423B` | Hover and input borders. |
| `accent` | `#33507A` | `#8FAAD4` | Primary action, citation marks, focus. |
| `accent-soft` | `#E7ECF3` | `#232A33` | Selected option, accent chips. |
| `ghost` | `#A5AAA0` | `#6E736B` | **Unaccepted AI text only.** |
| `draft` | `#F1F3EE` | `#22251F` | Draft-block tint (PRD §6.2). |
| `ok` / `warn` / `danger` | — | — | State, never decoration. Each has a `-soft` ground. |

The neutrals carry a slight cool-sage bias rather than being pure grey, and the dark palette keeps
that bias instead of inverting the light one. The accent lightens in dark so it still reads on a
dark ground; it is the same hue, not a different colour.

**Theme has three states, not two.** "System" is the default and stamps nothing on `<html>`, so
`prefers-color-scheme` decides. An explicit choice stamps `data-theme="light"` or `"dark"`, which
beats the media query in both directions. `ThemeScript` in `layout.tsx` applies the stored choice
synchronously before first paint — an effect would paint light and repaint dark, which is the
flash every themed app has to design around.

## Type

| Role | Face | Where |
|---|---|---|
| Prose | **Spectral** (`--font-serif`) | The writing column, headings, thesis titles. |
| Interface | **Source Sans 3** (`--font-sans`) | Menus, labels, meters, buttons. Never inside the writing column. |
| Data | system mono (`--font-mono`) | Keyboard hints, codes, ids. |

The student's thesis is set in the serif, so the editor reads as a manuscript rather than a form.
The chrome is set in the sans, so it is legible at 11px and never mistaken for content. That
division is the whole type system; there is no third voice.

Scale, in px, used as literals rather than Tailwind's `text-*` steps because the steps are tuned
for a different rhythm: 27 (page title) · 25 (section) · 16–17 (card title, thesis name) ·
14–15 (body) · 13 (labels, controls) · 12–12.5 (secondary) · 10.5–11 (eyebrow, badge, kbd).

Running prose sits at or under 62ch outside the editor; inside it, PRD §6.2's 72ch governs
(`--spacing-measure`). Headings take `text-wrap: balance`. Anything with digits in a column takes
`.tnum`.

## Shape and space

Radius `sm` 2px (badges, chips) · `md` 3px (buttons, inputs, cards) · `lg` 5px (the one framed
figure on the marketing page). **No shadows.** Depth is a hairline and a change of ground.

Layout uses flex/grid `gap`, never per-element margins that collapse or double. Wide content —
tables, code, the gap map — scrolls inside its own `overflow-x: auto` container so the body never
scrolls sideways.

## Components

`apps/web/src/components/ui/primitives.tsx` holds the shared vocabulary: `Card`, `CardBody`,
`CardHeader`, `Label`, `Hint`, `Input`, `Textarea`, `Select`, `Badge`, `Kbd`, `Eyebrow`,
`PageHeader`, `Empty`, `Divider`. `button.tsx` holds `Button`.

They live in one file deliberately. Their entire value is that they agree with each other about a
3px radius and a hairline rule; spread across twenty files they drift, and drift is what made the
app look unstyled to begin with.

**Buttons.** `primary` is reserved for the single action a screen exists to perform — one per
view. Everything alongside it is `secondary` or `ghost`. Two equally loud controls is the most
common way a calm screen stops being calm.

**Empty states** name the next action, not the absence (PRD §6.2).

**Focus** is one treatment everywhere: a 2px accent outline at 2px offset, set once in
`globals.css`. §6.4 requires every AI action to be keyboard-reachable, which is worth nothing if
the focus ring cannot be seen.

## Applied

Every screen is on the system: no hardcoded colour survives, so all of them theme correctly, and
headings, buttons, cards, chips and radii come from the same vocabulary.

Screens given a compositional pass — layout, hierarchy, spacing decided rather than inherited:
the marketing home, sign-in, the thesis list and the editor chrome (top bar, chapter rail, panel
tabs, the §6.3 keyboard legend).

The rest — proposal, sources, outline, review, submit, account, settings, admin, pricing, privacy,
refunds, institution, the guide view — are consistent and correct but were normalised rather than
composed. If one of them turns out to be doing a job its layout does not serve, that is the next
thing to fix, one screen at a time.

## Two rules that keep it from drifting

1. **No literal colour in a component.** Everything through a token, or dark mode breaks silently
   — which is exactly what had happened: 66 `bg-white` and 35 `text-white` were sitting in the
   tree, and `text-white` on `bg-ink` inverts to white-on-white.
2. **One primary per screen.** `bg-accent` means "the action this screen exists for". Selected
   chips and toggles use it too, so one colour answers "which is the live one?" everywhere. Black
   (`ink`) is body text and a scrim; it is never a control.
