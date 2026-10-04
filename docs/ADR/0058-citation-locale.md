# ADR-0058 — The citation locale: a per-thesis choice, and what "automatic" means

**Date:** 2026-10-04
**Status:** Accepted
**Builds on:** PRD FR-5.2 (style switch global and instant), §2.2 (document language), ADR-0018 /
ADR-0019 (the CSL catalogue), ADR-0021 (LaTeX export).

## What prompted it

`docs/research/coverage-map.md` row 26: Jenni lets the student pick a style's language — English
(UK) or (US) among others — which changes "and" / "&", "edn" / "ed.", quotation marks and date
order. We rendered every style in en-US (or the catalogue's `default-locale` for a journal), with
no choice.

## What citeproc can actually do here

Checked in `node_modules/@citation-js/plugin-csl` 0.8.2:

- It bundles **five** CSL locales (`lib/locales.json`): en-US, nl-NL, fr-FR, de-DE, es-ES.
- `lib/engines.js` silently replaces any other id with `undefined`. So asking for en-GB rendered
  exactly en-US — a choice would have done nothing.
- A catalogue journal whose `default-locale` is one of the missing ones (pt-BR, da-DK, de-CH… 14
  styles) made citeproc throw a `TypeError` reading the missing locale's terms: those journals
  could not render at all.

## Decisions

1. **en-GB is shipped**: `packages/citations/locales/locales-en-GB.xml`, verbatim from the CSL
   locales repository at commit `a89adece`, CC BY-SA 3.0 (README beside it), registered into the
   plugin's own locale registry on first render. The choice lists exactly six locales — the five
   bundled plus en-GB — and a unit test proves each is loadable. No other language is offered;
   adding one is a file and a row.
2. **Storage: `Document.citationLocale String?`** (migration `0038_citation_locale`), beside
   `citationStyle`, not inside `meta`: it is read on every render, exactly as the style is.
3. **Automatic (null) keeps today's output for every English thesis.** The order is: the
   student's choice → the document language when it names a locale unambiguously (`en-GB`,
   `en-US`, `de`, `fr`, `es`, `nl`) → the style's own `default-locale` → en-US. Plain `en`, the
   default for every thesis, maps to "the style's own", so no existing English thesis changes.
   We did not make en-GB the default for Indian universities: the PRD says nothing about it, and
   changing every existing bibliography silently is the kind of change the owner should make.
4. **Changed behaviour (the reason this is an ADR):** a thesis whose `language` is already set to
   German, French, Spanish or Dutch now gets that language's citation terms automatically, where
   before it got English ones inside non-English prose. A thesis whose language is exactly
   `en-GB` gets British terms. And a style whose own locale citeproc cannot load now renders with
   en-US terms instead of failing.
5. **Everything that prints a citation honours it**, because they all read
   `CitationsService.render`: editor labels, the Citations tab bibliography, the `@` picker, the
   chapter and thesis `.docx`/PDF, the HTML export and the compliance check. The LaTeX export,
   where biblatex rather than citeproc formats the list, passes `language=british` (etc.) to
   biblatex when a locale is in force, and nothing when automatic English is.
6. **The style preview** takes `?locale=`; the editor passes the thesis's locale, so a student
   sees their own "and" or "&" before choosing a style.
7. A copy of a thesis keeps its locale (ADR-0057).

## Not verified

The LaTeX `language=` option has not been compiled: there is no TeX installation on the build
machine. It is biblatex's documented option and the names are its `.lbx` files.
