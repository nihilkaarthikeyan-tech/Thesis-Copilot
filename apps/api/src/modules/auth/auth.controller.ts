/**
 * Mounts Better Auth under `/api/v1/auth/*` and exposes which sign-in methods are available.
 *
 * Better Auth speaks the web `Request`/`Response` API, so the Fastify request is converted at this
 * boundary and the response is copied back.
 */

import { All, Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Env } from '@tc/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ENV } from '../../common/env.token.js';
import type { Auth } from './auth.js';
import { isGoogleConfigured } from './auth.js';
import { AUTH } from './auth.tokens.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Lets the web app render only the sign-in methods that are actually configured. */
  @Get('methods')
  methods(): { emailOtp: boolean; google: boolean } {
    return { emailOtp: true, google: isGoogleConfigured(this.env) };
  }

  @All('*')
  async handle(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const url = new URL(request.url, this.env.API_URL);

    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value === undefined) continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    }

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const response = await this.auth.handler(
      new Request(url.toString(), {
        method: request.method,
        headers,
        ...(hasBody && request.body ? { body: JSON.stringify(request.body) } : {}),
      }),
    );

    reply.status(response.status);
    response.headers.forEach((value, key) => {
      // `set-cookie` may repeat and must not be collapsed into one header.
      if (key.toLowerCase() === 'set-cookie') reply.header('set-cookie', value);
      else reply.header(key, value);
    });
    reply.send(response.body ? await response.text() : null);
  }
}
