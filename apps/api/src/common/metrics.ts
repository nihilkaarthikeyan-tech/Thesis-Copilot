/**
 * Prometheus metrics — PRD §14.
 *
 * The metric names come straight from §14 so the dashboards in §11.5 and §14 can be built without
 * renaming anything later.
 */

import { Counter, collectDefaultMetrics, Histogram, Registry } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const aiCallLatency = new Histogram({
  name: 'ai_call_latency_ms',
  help: 'End-to-end latency of an AI call',
  labelNames: ['action', 'tier'] as const,
  buckets: [50, 100, 200, 400, 600, 1000, 2000, 5000, 10000, 30000],
  registers: [registry],
});

export const aiTtfb = new Histogram({
  name: 'ai_ttfb_ms',
  help: 'Time to first streamed byte. PRD 16 week 1 requires p95 <= 600 ms.',
  labelNames: ['action'] as const,
  buckets: [50, 100, 200, 300, 400, 500, 600, 800, 1200, 2000],
  registers: [registry],
});

export const aiCostMicroInr = new Counter({
  name: 'ai_cost_micro_inr_total',
  help: 'Cumulative AI cost in micro-rupees',
  labelNames: ['action'] as const,
  registers: [registry],
});

export const suggestionOutcome = new Counter({
  name: 'suggestion_outcome_total',
  help: 'Suggestion outcomes',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const capExceeded = new Counter({
  name: 'cap_exceeded_total',
  help: 'Requests refused because a monthly cap was reached',
  labelNames: ['action'] as const,
  registers: [registry],
});

export const hallucinatedCite = new Counter({
  name: 'hallucinated_cite_total',
  help: 'Citations stripped because the id was not in the retrieved set (PRD 10.6)',
  registers: [registry],
});
