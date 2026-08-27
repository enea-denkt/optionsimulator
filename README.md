# GammaLift Options Dashboard

A keyless, static options-analysis dashboard: Vite + React, live delayed
quotes from Cboe, no backend of its own. Scaffolded originally by Base44 —
`src/api/base44Client.js` is still wired for auth, but every number on every page
comes from `src/api/marketData.js`.

Live at <https://enea-denkt.github.io/optionsimulator/>.

## The pages

| Route | Page | The question it answers |
| --- | --- | --- |
| `/` | Options Simulator | How does this position behave under a scenario, and is the premium rich or cheap? |
| `/insights` | Chain Insights | What is the chain pricing for one name? |
| `/finder` | Contract Finder | Given a price view, which contract expresses it best? |
| `/compare` | Compare Companies | Which of these names has the expensive options? |
| `/exposure` | Dealer Exposure | Where do hedging flows pin or accelerate price? |

Every page keeps its controls in the query string, so any view is shared by
copying the address bar. Inputs travel, not derived values — the simulator
carries a contract's OCC symbol and re-reads strike, premium and IV from the live
chain, so a link opened next week shows current quotes rather than stale ones.

## The model

One American binomial tree (100 steps), exported as `americanOptionPrice` from
`src/lib/contractScreener.js` and imported by every page that prices a contract.
There is deliberately only one: a contract that is worth one number on one page
and another on the next is worse than either being wrong.

Pure, node-testable modules do the analysis:

| Module | Holds |
| --- | --- |
| `src/lib/contractScreener.js` | the pricer, chain-wide scenario ranking, return curves |
| `src/lib/premiumRichness.js` | overpay against a benchmark volatility, decay curves, the realized-vol distribution |
| `src/lib/optionAnalytics.js` | smile, term structure, max pain, expected move, realized vol |
| `src/lib/volatilityHistory.js` | rank and percentile, rolling series, chart range windows |
| `src/lib/optionComparison.js` | cross-name contract matching and comparison metrics |
| `src/lib/gammaExposure.js` | Black-Scholes gamma and vanna, dealer exposure, gamma flip |
| `src/lib/volatilitySurface.js` | smile and term curves for the comparison page |
| `src/lib/chartScale.js` | axis bounds and ticks that read like numbers a person would pick |
| `src/lib/useUrlState.js` | query-string state, shared by every page |
| `src/lib/tickerMemory.js` | the ticker carried between pages for the session |

### Two modelling choices worth knowing before reading a number

**Implied volatility cannot judge itself.** It is extracted from the premium, so
pricing a contract at its own IV returns its own price, to the cent, always.
Anywhere this app says a premium is rich or cheap, the reference is a **benchmark
volatility** — by default the stock's realized volatility, and adjustable — and
the gap between the two is the volatility risk premium in dollars.

**Volatility slides along the smile, it does not stick to the strike.** When a
scenario moves the underlying, a contract lands at a new moneyness and is repriced
at whatever that moneyness is quoted at today. Holding a wing option's own IV
fixed while walking spot toward its strike values a four-cent contract at seventy
cents and fills any ranking with contracts that expire worthless.

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

Published at <https://enea-denkt.github.io/optionsimulator/> from the `gh-pages`
branch. **`main` is source only — pushing to it does not change the live site.**

Deploys are done by building locally and force-pushing `dist` to `gh-pages`; the
exact commands, the deploy history and the failure modes are in
[CLAUDE.md](CLAUDE.md). The one thing that must not be forgotten:

```bash
VITE_MARKET_PROXY=https://market-proxy.<your-subdomain>.workers.dev npm run build
grep -oh 'market-proxy[^"]*workers\.dev' dist/assets/*.js   # must print the URL
```

Without that variable the build succeeds and the live site's data quietly breaks.

### Moving to Cloudflare Pages

A GitHub Pages site is publicly readable even when its repository is private, so
it cannot be put behind a login. The repo is ready for Cloudflare Pages instead —
`npm run build:cloudflare`, a `public/_redirects` for client-side routing, and
`functions/cboe/[[path]].js`, which serves the market-data pass-through from the
app's **own origin** so that Cloudflare Access gates the data as well as the UI.
The remaining steps are dashboard work and are written out in [CLAUDE.md](CLAUDE.md).

A GitHub Actions route exists in `.github/workflows/deploy.yml` and is **manual
trigger only** (Actions → Deploy to GitHub Pages → Run workflow) so a push can
never silently replace the live site. It has never been used, and it needs the
repo variable `MARKET_PROXY` set (Settings → Secrets and variables → Actions →
Variables) for the same reason as above.

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

## Where the reasoning lives

* [CLAUDE.md](CLAUDE.md) — what to run: deploy commands, deploy history, the
  conventions a new page has to follow.
* [learnings.md](learnings.md) — why: what the data does and does not support,
  the bugs the live feed exposed, and the modelling decisions behind each page.
* [building platform.md](building%20platform.md) — plans for turning this into a
  subscription product. None of it is built.
