/**
 * Injection token for the validated environment, in its own file.
 *
 * Tokens must not live in a module file: services import the token, the module imports the
 * services, and under ESM that cycle resolves to `undefined` at runtime rather than failing at
 * build time. Nest then reports "Nest can't resolve dependencies ... appears to be undefined".
 */
export const ENV = Symbol('ENV');
