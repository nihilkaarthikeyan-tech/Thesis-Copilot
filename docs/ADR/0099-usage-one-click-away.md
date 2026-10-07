# 0099 — Usage one click away

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R12; inventory §1)

## Context

Jenni's account menu, on every screen, shows a coloured bar for each allowance (green to red as it
fills). Ours: the Account page had the table, a page away, and the editor's header showed two
numbers (Assist and Draft).

## Decision

- `UsageMenu` (`components/UsageMenu.tsx`): a button opening a bar for every allowance the plan
  includes (green, amber from three quarters, red when used up — `lib/usage.ts`), the ones it does
  not, the renewal date, and a link to Account. It reads `GET /usage/me` when opened, so it is never
  stale; free.
- Where it sits: in the theses list's header (**Usage**, beside Account); in the editor, the
  existing "Assist 10/50 · Draft 0/2" counter opens it; on every other signed-in screen (outline,
  sources, proposal, submit, viva, the reports…), which draw only a breadcrumb line, a small
  **Usage** button at the top right (`UsageCorner`, in the app layout). Not on the Account page,
  which shows the full table.
- A trial that has ended says so at the top of the menu.

## Evidence

`apps/web/test/usage-menu.spec.ts` (the colours, including a zero allowance shown as used up, not
as an empty green bar). Browser, dev stack: the list's Usage, the editor's counter and the Outline
screen's corner button each opened the same nine bars and "Renews Nov 1, 2026"; the corner button
sat at the right edge, clear of the page's content.
