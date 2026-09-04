/**
 * Injection token in its own file so the controller and the module do not import each other.
 * A cycle between them breaks at runtime under ESM ("Cannot access 'AUTH' before initialization").
 */
export const AUTH = Symbol('AUTH');
