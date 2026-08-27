/**
 * The Cboe pass-through, running on the app's own origin.
 *
 * ## Why this exists when `proxy/cloudflare-worker.js` already does the job
 *
 * The standalone worker lives on `market-proxy.<account>.workers.dev` — a
 * different hostname from the app. That was fine while the site was public. It
 * stops being fine the moment the site is put behind Cloudflare Access, because
 * Access gates a *hostname*: the app would be locked and the data pipe feeding
 * it would still be open to anyone who knew the URL. Authenticating the UI while
 * leaving the API open protects nothing worth protecting.
 *
 * Serving the proxy from the same origin fixes that for free. Access sits in
 * front of the whole hostname, so every request to `/cboe/*` has already been
 * authenticated before this function runs. No JWT to verify, no CORS headers to
 * negotiate, no `Origin` allowlist to forge — the browser's fetch is same-origin
 * and carries the Access cookie without being asked.
 *
 * The app needs no code change to use it: `VITE_MARKET_PROXY` is concatenated in
 * front of the Cboe path, so setting it to the relative `/cboe` produces
 * `/cboe/api/global/...` against this origin.
 *
 * ## The allowlist is duplicated, on purpose
 *
 * `ALLOWED_PATHS` also appears in `proxy/cloudflare-worker.js`. That file is
 * deployed by pasting it into the Cloudflare dashboard, so it cannot import
 * anything, so the two cannot share a module. **Adding an endpoint means editing
 * both.** See CLAUDE.md.
 */

const UPSTREAM = 'https://cdn.cboe.com';

// Only the delayed-quotes endpoints the app actually uses. Without this the
// function is an open proxy for anything on cdn.cboe.com.
const ALLOWED_PATHS = [
  /^\/api\/global\/delayed_quotes\/options\/[A-Z0-9_.-]{1,24}\.json$/,
  /^\/api\/global\/delayed_quotes\/quotes\/[A-Z0-9_.-]{1,24}\.json$/,
  /^\/api\/global\/delayed_quotes\/symbol_book\/symbol-book\.json$/,
  // Daily OHLCV history: the price chart, realized volatility, and the
  // volatility indices (`_VIX`, `_VXAPL`) which share this path shape.
  /^\/api\/global\/delayed_quotes\/charts\/historical\/[A-Z0-9_.-]{1,24}\.json$/,
];

export async function onRequest({ request }) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Everything after /cboe is the Cboe path to mirror.
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/cboe/, '');

  if (!ALLOWED_PATHS.some((pattern) => pattern.test(path))) {
    return new Response('Not found', { status: 404 });
  }

  const upstream = await fetch(UPSTREAM + path, {
    headers: { Accept: 'application/json' },
    // Cboe refreshes these files every few minutes, so cache at the edge and
    // let repeat visitors never reach the origin at all.
    cf: { cacheTtl: 120, cacheEverything: true },
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 'public, max-age=120',
    },
  });
}
