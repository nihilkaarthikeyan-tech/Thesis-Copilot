/**
 * API entrypoint — NestJS 11 on Fastify (PRD §7.2).
 *
 * Boot order matters: the environment is validated first (PRD §0.2, the app refuses to start on a
 * missing required variable), then the global pieces from PHASES task 0.6 are installed —
 * problem-details, request id, Pino, `/metrics`, rate limiting.
 */

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { loadEnv } from '@tc/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { buildFastify, registerPlugins } from './bootstrap.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';

async function bootstrap(): Promise<void> {
  // Throws and exits if anything required is missing or malformed.
  const env = loadEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(buildFastify()),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new ProblemDetailsFilter());

  // PRD §9: "All endpoints under /api/v1". `/metrics` and `/health` are excluded so the scrape and
  // uptime paths stay stable.
  app.setGlobalPrefix('api/v1', { exclude: ['metrics'] });

  // `methods` is set explicitly: the default list does not include PUT, so the autosave preflight
  // (`PUT /chapters/:id`, Appendix B.7) was refused with "Method PUT is not allowed by
  // Access-Control-Allow-Methods". Only a browser surfaces that; server-side tests never preflight.
  app.enableCors({
    origin: env.APP_URL,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'accept', 'authorization', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    maxAge: 86_400,
  });

  await registerPlugins(app, env);

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');

  app.get(Logger).log(`API listening on http://0.0.0.0:${port}/api/v1`);
}

bootstrap().catch((error: unknown) => {
  console.error('API failed to start:', error);
  process.exit(1);
});
