/**
 * Written by `scripts/build.mjs` for each target (production, development) — ADR-0031. Declared
 * here so the code typechecks without a build.
 */

/** Where the API answers, with no trailing slash — `https://thesis.rademics.ai` in production. */
export declare const API_URL: string;
/** Where the website opens, for the "open Thesis Copilot" links. */
export declare const WEB_URL: string;
