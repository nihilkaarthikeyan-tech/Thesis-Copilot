import { Global, Inject, Module } from '@nestjs/common';
import type { Env } from '@tc/config';
import { ENV } from '../../common/env.token.js';
import { PrismaService } from '../../common/prisma.service.js';
import { AuthController } from './auth.controller.js';
import { type Auth, createAuth, isGoogleConfigured } from './auth.js';
import { AUTH } from './auth.tokens.js';
import { DevOtpController } from './dev-otp.js';

@Global()
@Module({
  // The dev OTP sink never exists in production (it also refuses at request time).
  controllers:
    process.env.NODE_ENV === 'production' ? [AuthController] : [DevOtpController, AuthController],
  providers: [
    {
      provide: AUTH,
      inject: [ENV, PrismaService],
      useFactory: (env: Env, prisma: PrismaService): Auth => createAuth(env, prisma),
    },
  ],
  exports: [AUTH],
})
export class AuthModule {
  constructor(@Inject(ENV) env: Env) {
    if (!isGoogleConfigured(env)) {
      // eslint-disable-next-line no-console
      console.warn(
        '[auth] Google sign-in is disabled: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are unset. ' +
          'Email OTP still works. See PHASES.md PHASE-0 preconditions.',
      );
    }
  }
}

export { AUTH };
