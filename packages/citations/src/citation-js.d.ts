/**
 * `@citation-js/core` and its plugins ship no type declarations (checked in
 * `node_modules/@citation-js/core/package.json`: no `types`, no `@types/citation-js__core` on
 * npm). This declares only what the package actually calls, so a change in any of them is a type
 * error here rather than a runtime surprise.
 *
 *   - `plugins.config.get('@csl')` — the citeproc engine, in `render.ts`.
 *   - `plugins.output.format(name, items, options)` — `bibtex` and `ris`, in `library-export.ts`.
 *     Checked in `node_modules/@citation-js/core/lib/plugins/output.js`: throws when the named
 *     format is not registered, which is what the two plugin imports below register.
 */

declare module '@citation-js/core' {
  export const plugins: {
    config: { get(name: string): unknown };
    output: {
      format(name: string, data: unknown[], options?: { format?: 'text' | 'html' }): unknown;
    };
  };
}

declare module '@citation-js/plugin-csl';
declare module '@citation-js/plugin-bibtex';
declare module '@citation-js/plugin-ris';
