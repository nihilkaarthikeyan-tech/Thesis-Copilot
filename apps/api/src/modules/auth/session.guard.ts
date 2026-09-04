/**
 * Rejects a request with no valid session — PRD §12.1.
 *
 * The session is resolved from the cookie by Better Auth and attached to the request, so
 * controllers read `@CurrentUser()` and never touch cookies.
 */

import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../../common/errors.js';
import type { Auth } from './auth.js';
import { AUTH } from './auth.tokens.js';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value === undefined) continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    }

    const session = await this.auth.api.getSession({ headers });
    if (!session?.user) throw new UnauthorizedError();

    (request as { user?: unknown }).user = {
      id: session.user.id,
      email: session.user.email,
      role: (session.user as { role?: string }).role ?? 'STUDENT',
      plan: (session.user as { plan?: string }).plan ?? 'FREE_TRIAL',
    };

    return true;
  }
}
