# Base44 App


This app was created automatically by Base44.
It's a Vite+React app that communicates with the Base44 API.

## Running the app

```bash
npm install
npm run dev
```

Open the URL Vite prints: http://localhost:5173/optionsimulator/

## Building the app

```bash
npm run build                      # GitHub Pages build (base /optionsimulator/)
VITE_BASE=/member/ npm run build   # gammalift member-area build
```

## Deploying

Published at https://enea-denkt.github.io/optionsimulator/ from the `gh-pages`
branch. The workflow in `.github/workflows/deploy.yml` builds and publishes it —
it is **manual trigger only** (Actions → Deploy to GitHub Pages → Run workflow),
so a push never silently replaces the live site.

Before the first deploy, set the repo variable `MARKET_PROXY` to your worker URL
(Settings → Secrets and variables → Actions → Variables). Without it the app falls
back to public CORS proxies, which are unreliable.

## Live market data

Ticker search and option contracts are loaded at runtime from **Cboe's public
delayed-quotes feed** (`cdn.cboe.com`). It is free, needs no account and **no API
key**, so nothing secret is ever shipped to the browser. It provides:

* every listed symbol (ticker + company name) for the ticker search box
* the full option chain per symbol: bid, ask, last trade, IV, greeks, open interest
* the underlying stock price

Quotes are delayed, not real time. Implementation: `src/api/marketData.js`.

### Why a pass-through is needed

Cboe answers `Access-Control-Allow-Origin: https://www.cboe.com`, so a browser on
any other origin is not allowed to read the response. The data is public; only the
*browser* is blocked. Requests therefore go through a keyless pass-through, picked
in this order — the first one that answers is used for the rest of the session:

| Order | Gateway | When |
| --- | --- | --- |
| 1 | Vite dev proxy (`/cboe/*`, see `vite.config.js`) | `npm run dev` — works out of the box |
| 2 | `VITE_MARKET_PROXY` | production |
| 3 | Public CORS proxies | last-resort fallback |

The public proxies (allorigins, codetabs) need no setup but are rate-limited and
frequently down — they were failing during testing. **For a static deployment such
as GitHub Pages, set up your own pass-through.**

### Production setup (static hosting / GitHub Pages)

`proxy/cloudflare-worker.js` is a ~40-line Cloudflare Worker that mirrors the Cboe
paths and adds CORS headers. It is free (~100k requests/day), holds no credentials,
and only forwards the three delayed-quote paths this app uses, so it cannot be
abused as an open proxy.

1. Cloudflare dashboard → Workers & Pages → Create → paste `proxy/cloudflare-worker.js` → Deploy
2. Build the app pointing at it:

```bash
VITE_MARKET_PROXY=https://market-proxy.<your-subdomain>.workers.dev npm run build
```

Or commit the value to a `.env.production` file (see `.env.example`).

For more information and support, please contact Base44 support at app@base44.com.
