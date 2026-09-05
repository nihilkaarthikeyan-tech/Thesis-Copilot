/**
 * Load test — PRD §15, PHASES 5.7.
 *
 *   "k6: 200 concurrent Assist streams for 5 minutes against the VPS with the mock provider at
 *    250 ms; record p50/p95 TTFB, error rate, CPU/RAM. Done when: p95 TTFB ≤ 600 ms and error
 *    rate < 0.5% on the VPS."
 *
 * Run on the VPS (or against it) with the API on the mock provider:
 *
 *   k6 run -e API_URL=https://app.example.com -e COOKIE='better-auth.session_token=…' \
 *          -e CHAPTER_ID=<uuid> infra/k6/assist-stream.js
 *
 * `COOKIE` is a session for one account. No plan's monthly Assist cap covers 200 VUs × 5 min,
 * so reset that account's ledger between runs (`POST /admin/users/:id/reset-caps`, PHASES 5.9)
 * or raise its cap for the test. `CHAPTER_ID` is one of that account's chapters.
 *
 * k6 has no SSE client; the request is a plain POST with `accept: text/event-stream` and the whole
 * body is read. TTFB is `res.timings.waiting`, which is exactly what the product measures: the
 * time to the first byte of the stream, i.e. the first token.
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';

const API_URL = __ENV.API_URL || 'http://localhost:3001';
const COOKIE = __ENV.COOKIE || '';
const CHAPTER_ID = __ENV.CHAPTER_ID || '';

const ttfb = new Trend('assist_ttfb_ms', true);
const errors = new Rate('assist_errors');

export const options = {
  scenarios: {
    assist: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 200),
      duration: __ENV.DURATION || '5m',
    },
  },
  thresholds: {
    // §15: p95 TTFB ≤ 600 ms, error rate < 0.5%.
    assist_ttfb_ms: ['p(95)<600'],
    assist_errors: ['rate<0.005'],
  },
};

const BEFORE = [
  'Prior studies in Karnataka found that upfront cost was the main barrier reported by households. ',
  'The survey covered 312 households across three districts between March and July. ',
  'Awareness of subsidy schemes was high, yet uptake remained below ten percent. ',
];

export default function () {
  const body = JSON.stringify({
    chapterId: CHAPTER_ID,
    before: BEFORE[__VU % BEFORE.length],
    after: '',
  });
  const res = http.post(`${API_URL}/api/v1/assist/suggest`, body, {
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      cookie: COOKIE,
    },
    timeout: '30s',
  });

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'is a stream': (r) => (r.headers['Content-Type'] || '').includes('text/event-stream'),
    'has a done event': (r) => typeof r.body === 'string' && r.body.includes('event: done'),
  });
  errors.add(!ok);
  if (res.status === 200) ttfb.add(res.timings.waiting);

  // A student does not fire suggestions back to back; ~1 s between keeps 200 VUs at ~150 rps.
  sleep(1);
}

export function handleSummary(data) {
  const t = data.metrics.assist_ttfb_ms ? data.metrics.assist_ttfb_ms.values : {};
  const e = data.metrics.assist_errors ? data.metrics.assist_errors.values : {};
  const lines = [
    '',
    'Assist stream load test (PRD §15)',
    `  requests   ${data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0}`,
    `  TTFB p50   ${Math.round(t.med || 0)} ms`,
    `  TTFB p95   ${Math.round(t['p(95)'] || 0)} ms   (ceiling 600)`,
    `  errors     ${((e.rate || 0) * 100).toFixed(2)} %   (ceiling 0.5)`,
    '',
  ];
  return { stdout: lines.join('\n') };
}
