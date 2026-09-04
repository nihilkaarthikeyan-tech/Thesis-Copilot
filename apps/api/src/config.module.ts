import { Global, Module } from '@nestjs/common';
import { type Env, loadEnv } from '@tc/config';
import { ENV } from './common/env.token.js';
import { PrismaService } from './common/prisma.service.js';

/**
 * Validates the environment once, at boot. `loadEnv` throws on anything missing or malformed, and
 * nothing catches it, so the process exits (PRD §0.2).
 */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv() }, PrismaService],
  exports: [ENV, PrismaService],
})
export class AppConfigModule {}

export { ENV };
