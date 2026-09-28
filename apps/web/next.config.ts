import type { NextConfig } from 'next';

/**
 * Content-Security-Policy (2026-09-28). The browser refuses anything this list does not name:
 * scripts, styles and fonts come only from this site; images from this site (figures and exports
 * are served through it, `S3_PUBLIC_URL`) plus inline `data:`/`blob:` ones; network calls only to
 * the API and its live-editing socket. No plugins, no other site may frame a page, a form may only
 * post here, and a `<base>` tag cannot re-point relative links.
 *
 * Scripts keep `'unsafe-inline'`: Next.js writes its own bootstrap inline, and so does the theme
 * script that stops a dark-mode flash. A nonce would remove it but make every page dynamically
 * rendered; recorded as a follow-up in docs/BUILD_LOG.md rather than traded silently.
 *
 * Built into the image at `next build`, so the API origin is the build-time
 * `NEXT_PUBLIC_API_URL`. In development the API and MinIO are on other ports and Next's own
 * reloader needs `eval` and a websocket; production needs none of that.
 */
function contentSecurityPolicy(): string {
  const dev = process.env.NODE_ENV !== 'production';
  const api = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001');
  const socket = `${api.protocol === 'https:' ? 'wss' : 'ws'}://${api.host}`;
  // Where a browser loads a signed figure or download from: `S3_PUBLIC_URL` when set, else
  // `S3_ENDPOINT` — the host the API signs for. The production image is built without either (its
  // links are this site's own origin), so this adds nothing there; a build that sees the dev or CI
  // `.env` allows the MinIO the browser really fetches from. The first CI run limited this to
  // development and blocked every figure under `next start` (2026-09-28).
  const signedFor = process.env.S3_PUBLIC_URL || process.env.S3_ENDPOINT;
  const storage =
    signedFor && URL.canParse(signedFor) ? [new URL(signedFor).origin] : ([] as string[]);

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    ["img-src 'self' data: blob:", ...storage].join(' '),
    "font-src 'self' data:",
    ["connect-src 'self'", api.origin, socket, ...storage, ...(dev ? ['ws://localhost:*'] : [])]
      .filter((v, i, all) => all.indexOf(v) === i)
      .join(' '),
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image (infra/docker/Dockerfile.web).
  output: 'standalone',
  // Workspace packages ship TypeScript sources alongside dist; let Next compile them if imported.
  transpilePackages: ['@tc/config', '@tc/types', '@tc/ui'],
  poweredByHeader: false,
  // The development "N" badge sits bottom-left, which is where the editor's bar puts "Chapters" on
  // a phone; every other corner covers a real control too. It only ever exists under `next dev`,
  // and it was intercepting taps in the mobile specs. Build and runtime errors still show.
  devIndicators: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: contentSecurityPolicy() }],
      },
    ];
  },
};

export default nextConfig;
