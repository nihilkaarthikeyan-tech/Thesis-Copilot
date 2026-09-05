/**
 * Sentry — PRD §14, PHASES 5.5: "Sentry (if `SENTRY_DSN`)".
 *
 * Without a DSN nothing is initialised and `captureException` is a no-op, so dev and test never
 * talk to Sentry. With one, unhandled 5xx responses and worker job failures are reported with the
 * request or job id and nothing else: no bodies, no thesis text, no prompts (§12.2, and the same
 * rule the Pino logger follows).
 */

import * as Sentry from '@sentry/node';

let enabled = false;

export function initSentry(dsn: string | undefined, service: 'api' | 'worker'): boolean {
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.APP_VERSION,
    serverName: service,
    // Errors only. Tracing would sample request bodies into a third party, which §12.2 forbids.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  enabled = true;
  return true;
}

export function captureException(error: unknown, context: Record<string, unknown> = {}): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) scope.setTag(key, String(value));
    Sentry.captureException(error);
  });
}

export function sentryEnabled(): boolean {
  return enabled;
}
