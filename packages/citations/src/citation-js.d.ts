/**
 * `@citation-js/core` and `@citation-js/plugin-csl` ship no type declarations (checked in
 * `node_modules/@citation-js/core/package.json`: no `types`, no `@types/citation-js__core` on
 * npm). This declares only what `render.ts` actually calls, so a change in either package is a
 * type error here rather than a runtime surprise.
 */

declare module '@citation-js/core' {
  export const plugins: {
    config: { get(name: string): unknown };
  };
}

declare module '@citation-js/plugin-csl';
