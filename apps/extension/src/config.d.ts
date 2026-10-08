/**
 * Written by `scripts/build.mjs` for each target (production, development) — ADR-0031. Declared
 * here so the code typechecks without a build.
 */

/** Where the API answers, with no trailing slash — `https://thesis.rademics.ai` in production. */
export declare const API_URL: string;
/** Where the website opens, for the "open Thesis Copilot" links. */
export declare const WEB_URL: string;
/**
 * The in-page buttons' shadow roots (ADR-0125): `closed` in production, so the host page's
 * scripts cannot read the card (the student's thesis titles). Only a development build made with
 * `--open-shadow`, for the browser test, opens them.
 */
export declare const INPAGE_SHADOW: ShadowRootMode;
