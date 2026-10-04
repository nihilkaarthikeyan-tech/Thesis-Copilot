# CSL locales

`@citation-js/plugin-csl` 0.8.2 bundles five CSL locales (en-US, nl-NL, fr-FR, de-DE, es-ES).
The files here add the ones it lacks; `src/locales.ts` registers them with citeproc (ADR-0058).

`locales-en-GB.xml` comes verbatim from the Citation Style Language project
(https://github.com/citation-style-language/locales) at commit
`a89adece41013402236e2c9020972d7e931fbab8`, published under **CC BY-SA 3.0**. Nothing in it has
been edited.

To add a locale: drop the file here, add it to `SHIPPED` and `CITATION_LOCALES` in
`src/locales.ts`; the unit test checks every offered locale is loadable.
