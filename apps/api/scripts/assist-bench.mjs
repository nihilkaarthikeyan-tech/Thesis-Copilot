#!/usr/bin/env node
/**
 * PHASES 1.9 — latency measurement.
 *
 * Signs in a fresh user (dev OTP sink), creates a document, runs N `/assist/suggest` calls in
 * sequence against the running API, and prints p50/p95 for:
 *   client TTFB   — request start → first `token` event, as the browser would see it
 *   server ttfbMs — the API's own timer, from the `done` event
 *   latency       — request start → `done`
 *
 * The mock provider waits AI_MOCK_LATENCY_MS (250) before its first chunk, so
 * overhead = server ttfb − 250. PHASES 1.9: p95 TTFB ≤ 600 ms; if overhead > 350 ms, profile.
 *
 *   node apps/api/scripts/assist-bench.mjs [count=50] [api=http://localhost:3001]
 */

const count = Number(process.argv[2] ?? 50);
const api = `${process.argv[3] ?? 'http://localhost:3001'}/api/v1`;
const email = `bench-${Date.now()}@example.com`;
let cookie = '';

// Better Auth refuses POSTs with no Origin ("MISSING_OR_NULL_ORIGIN"); send the trusted web origin.
const origin = process.env.APP_URL ?? 'http://localhost:3000';
const call = (path, init = {}) =>
  fetch(api + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      origin,
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function readSse(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i = buf.indexOf('\n\n');
    while (i !== -1) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1] ?? '{}';
      onEvent(ev, JSON.parse(data));
      i = buf.indexOf('\n\n');
    }
  }
}

(async () => {
  const must = async (label, res) => {
    if (!res.ok)
      throw new Error(`${label}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  };
  await must(
    'send otp',
    await call('/auth/email-otp/send-verification-otp', {
      method: 'POST',
      body: JSON.stringify({ email, type: 'sign-in' }),
    }),
  );
  const { otp } = await (
    await must('dev otp', await call(`/auth/dev/last-otp?email=${encodeURIComponent(email)}`))
  ).json();
  const signIn = await must(
    'sign in',
    await call('/auth/sign-in/email-otp', { method: 'POST', body: JSON.stringify({ email, otp }) }),
  );
  const setCookie = signIn.headers.get('set-cookie') ?? '';
  cookie = setCookie.split(';')[0];
  if (!cookie.includes('session_token')) {
    throw new Error(
      `sign in returned no session cookie. status=${signIn.status} set-cookie=${setCookie.slice(0, 120)} body=${(await signIn.text()).slice(0, 160)}`,
    );
  }
  const doc = await (
    await call('/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'bench', entryPath: 'B_PAPER' }),
    })
  ).json();
  const chapterId = doc.firstChapterId;

  const clientTtfb = [];
  const serverTtfb = [];
  const latency = [];
  let refused = 0;

  for (let i = 0; i < count; i++) {
    const t0 = performance.now();
    const res = await call('/assist/suggest', {
      method: 'POST',
      body: JSON.stringify({
        chapterId,
        before: `Run ${i}: prior studies found `,
        after: '',
        cursorContext: { blockType: 'paragraph' },
      }),
    });
    if (res.status !== 200) {
      refused++;
      console.log(`  call ${i + 1}: HTTP ${res.status} ${(await res.text()).slice(0, 80)}`);
      continue;
    }
    let first = null;
    let done = null;
    await readSse(res, (ev, data) => {
      if (ev === 'token' && first === null) first = performance.now() - t0;
      if (ev === 'done') done = data;
    });
    clientTtfb.push(first ?? Number.NaN);
    serverTtfb.push(done?.ttfbMs ?? Number.NaN);
    latency.push(performance.now() - t0);
    process.stdout.write('.');
  }
  console.log('');

  const row = (label, arr) =>
    console.log(
      `${label.padEnd(14)} p50 ${String(Math.round(pct(arr, 50))).padStart(5)} ms   p95 ${String(Math.round(pct(arr, 95))).padStart(5)} ms   min ${String(Math.round(Math.min(...arr))).padStart(4)}   max ${String(Math.round(Math.max(...arr))).padStart(4)}`,
    );
  console.log(
    `\nassist-bench: ${clientTtfb.length} streamed, ${refused} refused, mock latency 250 ms`,
  );
  row('client TTFB', clientTtfb);
  row('server ttfbMs', serverTtfb);
  row('latency', latency);
  const overhead = Math.round(pct(serverTtfb, 95)) - 250;
  console.log(
    `overhead p95 (server ttfb − 250) = ${overhead} ms   →   ${pct(serverTtfb, 95) <= 600 ? 'OK: p95 TTFB ≤ 600 ms' : 'FAIL: p95 TTFB > 600 ms'}${overhead > 350 ? ' — overhead > 350 ms, profile before continuing' : ''}`,
  );

  // Bonus: the very next call after the FREE_TRIAL cap (50) must be refused with 429.
  const extra = await call('/assist/suggest', {
    method: 'POST',
    body: JSON.stringify({ chapterId, before: 'x', after: '' }),
  });
  console.log(
    `call ${count + 1} (cap check): HTTP ${extra.status} ${extra.status === 429 ? '— CAP_EXCEEDED as expected' : ''}`,
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
