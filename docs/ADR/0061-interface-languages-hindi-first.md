# ADR-0061 — Interface languages, Hindi first, as beta

**Date:** 2026-10-05
**Status:** Accepted
**Builds on:** ADR-0059 row 89 (the owner delegated it: "build the mechanism and Hindi first"),
PRD §2.2 (the thesis's own language), `docs/research/coverage-map.md` row 89.

## What prompted it

Jenni offers sixteen interface languages, Hindi among them; ours was English only. ADR-0059 settled
the scope: the mechanism, Hindi first, the student's main screens, marked beta, English for any
string not yet translated, and every translated string reviewed by a native speaker before the
beta mark comes off.

## Decisions

1. **No library.** A typed catalogue per language — `apps/web/src/i18n/en.ts` (the source, `as
   const`, so `MessageKey` is the union of its keys) and `hi.ts` (`Partial<Record<MessageKey,
   string>>`, so a Hindi key English lacks is a type error and a missing one is allowed).
   `translate(language, key, vars)` fills `{name}` placeholders and falls back to English per key.
   Plurals are two keys (`list.countOne` / `list.countMany`); Hindi needs nothing more for the
   strings in scope. An ICU formatter or `next-intl` would add a dependency, a provider tree and a
   message syntax for no case we have. Boring wins (PRD v2 §0.3 rule 5).

2. **Elements inside a sentence go through `rich()`.** A `<kbd>`, a link or a `<strong>` inside a
   sentence is a `{slot}` in the template; `rich(key, { slot: <kbd/> })` cuts the template at its
   slots and puts the element where *that language* put the placeholder — Hindi word order differs
   ("{tab} से सुझाव रखें"), so concatenating English-ordered fragments was not an option.

3. **Where the choice lives — three copies, each with one job.**
   - The **`tc-lang` cookie** is what the server reads. New server layouts for `/app/**` and
     `/sign-in` read it and render the first paint in the right language, so there is no English
     flash before Hindi. (The root layout does not read it: that would make every marketing page
     dynamic, and they are out of scope.) The same layouts render a one-line script that sets
     `<html lang="hi">` before paint.
   - **localStorage** holds the same value, in case the cookie alone is cleared.
   - The **account**: `PUT /settings` takes `interfaceLanguage: 'en' | 'hi'` (zod in
     `apps/api/src/modules/assist/chat.controller.ts`; the setting lives in `User.settings` JSON, so
     no migration). On the signed-in screens the provider reads `GET /settings` once per tab and
     adopts the account's language, or, if the account has none and the browser chose Hindi on the
     sign-in page, saves it to the account. The sign-in page clears the once-per-tab mark so the
     next account to sign in is asked afresh.

4. **Not the thesis's language.** PRD §2.2's document language (`PUT /documents/:id/language`,
   what the AI writes in) is untouched and never reads this one; nothing on the server reads
   `interfaceLanguage` at all. The Settings text says so in both languages.

5. **Scope — the screens a student uses every day.** The signed-in header and thesis list, the
   new-thesis form and starting citation style, the proposal screen and its topic conversation, the
   editor's chrome (header, banners, chapter rail, panel tabs, keyboard hints, notices, feedback
   form, the formatting toolbar's tooltips, the suggestion bar, the selection toolbar), Settings,
   Account, the free-trial notice, and sign-in. **Not:** the thesis text, anything the AI writes
   (including the refine presets' instructions, which stay English — only their button labels are
   translated), help articles, admin screens, emails, legal pages, the panels inside the editor's
   tabs (Sources, Papers, Citations, Chat, Flags, Review), and labels the API sends (the setup
   checklist, the next action, allowance names from `@tc/config`). Those read in English until a
   later pass; that is what "beta" means here.

6. **English must not move.** Every English value is the exact text the screen had, apostrophes
   included, because the Playwright suite finds elements by it. Default is English; with no cookie
   and no account setting nothing changes for anyone.

7. **Hindi wording.** Everyday Hindi for sentences; the English word where that is what Indian
   universities and students say — थीसिस (not शोध-प्रबंध), साइटेशन, पेपर, लाइब्रेरी, PDF.
   Product names stay as they are: Assist, Draft, Suggest, Thesis Copilot, APA 7, Word, Google,
   Razorpay. Sentences end in a danda. The picker names the language in itself: "हिन्दी (बीटा)".

8. **Font.** Satoshi has no Devanagari. `layout.tsx` loads Noto Sans Devanagari through
   `next/font/google` with `preload: false`, and `globals.css` adds it to `--font-sans` only under
   `html[lang="hi"]`, after Satoshi — Latin letters and digits keep Satoshi, Devanagari glyphs
   fall through to Noto, and an English page never downloads it. The `.eyebrow` label's letter
   spacing is turned off for Hindi: spacing pulls conjuncts apart. The thesis text keeps Spectral.

9. **Review before beta ends.** `docs/i18n/hi-review.md` lists every translated string beside its
   English source, with a column for corrections. It is generated from the catalogues
   (`apps/web/src/i18n/review.ts`) and a unit test fails when it is stale, so the sheet cannot
   drift from what ships. `docs/PENDING.md`: "Hindi leaves beta after a native speaker reviews
   docs/i18n/hi-review.md". Tamil and the others follow the same route — a catalogue, a sheet,
   a review — once Hindi has been through it.

## Consequences

- Adding a string to a translated screen means adding a key to `en.ts`; Hindi falls back to it
  until translated, and the review sheet lists it under "left in English" until then.
- `/app/**` and `/sign-in` are rendered per request (they read a cookie). Both were client pages
  behind a session already; nothing cached is lost.
- A callback that sets a notice outside a render uses `tNow()`, which reads the language the
  provider last rendered, so a stale closure cannot show the old language.
