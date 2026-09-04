import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { registry } from '../../common/metrics.js';

/**
 * `GET /metrics` — PRD §14. Outside the `/api/v1` prefix so Prometheus scrapes a stable path.
 * Not exposed publicly: it sits on the internal Compose network (PRD §13.1).
 */
@Controller()
export class MetricsController {
  @Get('metrics')
  async scrape(@Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  }
}
