/**
 * Keyless CORS pass-through for Cboe's public delayed-quotes CDN.
 *
 * Why this exists: cdn.cboe.com serves free option chains with no API key, but
 * answers `Access-Control-Allow-Origin: https://www.cboe.com`, so a static site
 * (GitHub Pages included) cannot read it from JavaScript. This worker sits in
 * front and adds the CORS header. It holds no credentials of any kind — there is
 * nothing here to leak, which is why publishing this file is harmless.
 *
 * Deploy (free tier, ~100k requests/day):
 *   1. dash.cloudflare.com -> Workers & Pages -> Create -> paste this file
 *   2. Deploy, note the URL, e.g. https://market-proxy.<you>.workers.dev
 *   3. Set that URL as the MARKET_PROXY variable in the GitHub repo settings
 *      (Settings -> Secrets and variables -> Actions -> Variables), so the
 *      deploy workflow builds against it.
 *
 * Then the app requests <worker>/api/global/delayed_quotes/options/MSTR.json
 * and the worker mirrors that path to Cboe.
 *
 * Protection, in layers:
 *   - path allowlist  : cannot be repurposed as a general-purpose open proxy
 *   - origin allowlist: browsers on other sites are refused
 *   - rate limit      : caps how fast any single IP can pull
 *   - edge cache      : repeat requests never reach Cboe at all
 */

const UPSTREAM = 'https://cdn.cboe.com';

// Only proxy the delayed-quotes endpoints the simulator actually uses.
const ALLOWED_PATHS = [
  /^\/api\/global\/delayed_quotes\/options\/[A-Z0-9_.-]{1,24}\.json$/,
  /^\/api\/global\/delayed_quotes\/quotes\/[A-Z0-9_.-]{1,24}\.json$/,
  /^\/api\/global\/delayed_quotes\/symbol_book\/symbol-book\.json$/,
];

// Sites allowed to call this worker. Note that a browser sends Origin honestly
// but curl can forge it, so treat this as a deterrent against casual embedding
// on someone else's page — the rate limit below is what caps real abuse.
const ALLOWED_ORIGINS = [
  'https://enea-denkt.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
];

// Requests per IP per window. The app pulls a chain once per ticker and caches
// it for 5 minutes, so a normal session is a handful of requests.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

/**
 * Best-effort in-memory limiter. Each worker isolate keeps its own counters, so
 * this throttles bursts rather than enforcing a precise global quota — good
 * enough to stop a script hammering the endpoint. For a hard guarantee, add a
 * Cloudflare WAF rate-limiting rule on the worker route in the dashboard.
 */
const hits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    // Opportunistic cleanup so the map cannot grow without bound.
    if (hits.size > 10_000) {
      for (const [key, value] of hits) if (now > value.resetAt) hits.delete(key);
    }
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

function corsHeaders(origin, extra = {}) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    ...extra,
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');

    // Requests with no Origin (curl, server-side callers) are allowed through
    // read-only, but get no CORS grant, so no browser can consume the response.
    const allowed = origin ? ALLOWED_ORIGINS.includes(origin) : true;
    if (!allowed) {
      return new Response('Origin not allowed', { status: 403 });
    }
    const grantedOrigin = origin || ALLOWED_ORIGINS[0];

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(grantedOrigin) });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(grantedOrigin) });
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (isRateLimited(ip)) {
      return new Response('Rate limit exceeded', {
        status: 429,
        headers: corsHeaders(grantedOrigin, { 'Retry-After': '60' }),
      });
    }

    const { pathname } = new URL(request.url);
    if (!ALLOWED_PATHS.some((pattern) => pattern.test(pathname))) {
      return new Response('Not found', { status: 404, headers: corsHeaders(grantedOrigin) });
    }

    const upstream = await fetch(UPSTREAM + pathname, {
      headers: { Accept: 'application/json' },
      // Cboe refreshes these files every few minutes; cache at the edge so
      // repeat visitors do not each hit the origin.
      cf: { cacheTtl: 120, cacheEverything: true },
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: corsHeaders(grantedOrigin, {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'public, max-age=120',
      }),
    });
  },
};
