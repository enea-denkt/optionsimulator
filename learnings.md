# Learnings — live market data in a static options simulator

Notes from wiring online ticker search and live option chains into this app,
written down so the reasoning is not lost. Everything below was tested, not
assumed; dates and figures are from 2026-08-16.

---

## 1. The data is free. The browser is the problem.

The hard constraint is not cost or API keys — it is **CORS**. A static site has no
backend, so every request comes from the browser, and the browser refuses to read
a cross-origin response unless the server explicitly permits it.

What was actually tested:

| Source | Key needed | Browser-readable | Notes |
| --- | --- | --- | --- |
| **Cboe** `cdn.cboe.com` | no | **no** | Returns `Access-Control-Allow-Origin: https://www.cboe.com` only |
| Yahoo Finance | no | no | No CORS headers; also returns 401/429 to non-browser clients |
| Nasdaq `api.nasdaq.com` | no | no | 200, but no CORS headers at all |
| OptionsProfitCalculator | no | no | Same — 200 with no CORS headers |
| Alpha Vantage | **yes** | yes (`*`) | Key would be exposed in a static bundle |
| marketdata.app | **yes** | yes (`*`) | 401 without a token, but CORS-friendly |

**Conclusion:** every keyless source blocks browser reads, and every browser-readable
source needs a key. There is no fourth option. A pass-through is unavoidable.

The useful corollary: since the pass-through is unavoidable anyway, it is also the
right place to hold a key later — the key stays server-side and the browser never
sees it.

## 2. Public CORS proxies are not a production dependency

`allorigins` and `codetabs` need no setup, so they are kept as a last-resort
fallback, but during testing they returned **502, 522 and rate-limit errors**, and
failed outright in a real browser. They are fine for a demo and unfit for anything
users rely on. Hence `proxy/cloudflare-worker.js`.

## 3. What is public in a static app, and what that costs

Anything the browser can reach is public — the worker URL is compiled into the
JavaScript bundle and visible in DevTools. This is inherent to client-side apps,
not to GitHub Pages, and it is **not** fixed by GitHub Actions secrets or an
uncommitted `.env`: the value lands in the shipped bundle regardless. Hiding the
source of a value that ships publicly is self-deception.

So the rule is: **never put anything in the bundle you would not publish on a
billboard.** A worker URL passes that test. An API key never does.

The worker is protected by defence in depth instead of by secrecy:

* **path allowlist** — cannot be repurposed as a general-purpose open proxy
* **origin allowlist** — refuses browsers on other sites (spoofable by curl, so it
  deters casual embedding rather than determined abuse)
* **rate limit** — 60 requests per IP per minute, best-effort per isolate
* **edge cache** — 120s, so repeat traffic never reaches Cboe

## 4. Cboe's terms prohibit this use

Found on Cboe's own delayed-quotes page:

> IT IS STRICTLY PROHIBITED TO DOWNLOAD DELAYED QUOTE TABLE DATA FROM THIS WEB SITE
> BY USING AUTO-EXTRACTION PROGRAMS/QUERIES AND/OR SOFTWARE. CBOE WILL BLOCK IP
> ADDRESSES OF ALL PARTIES WHO ATTEMPT TO DO SO. THIS DATA IS PROPERTY OF CBOE
> LIVEVOL OR ITS DATA PROVIDERS.

This is what the current implementation does. Two specifics make it sharper than it
first looks: a worker funnels every user through one set of IPs, so a block takes
the feature down for everyone at once; and redistributing LiveVol data through a
paid product is a different question than personal use.

**Migration path when needed:** all data access is isolated in `src/api/marketData.js`
and everything crosses the network through the worker. Switching to a licensed
provider (marketdata.app, Polygon, Tradier, IBKR) means changing the worker's
upstream, storing the key as a **Worker secret**, and rewriting one normalizer
function. No UI changes.

## 5. Update cadence of the Cboe feed

Measured, market closed (Sunday):

* `cache-control: max-age=0, s-maxage=5` — the CDN holds a response 5 seconds
* files are regenerated **per symbol**, not in one sweep (MSTR `03:42`, IBIT `12:37`)
* every `last_trade_time` showed the previous session's close

Not measured: the intraday refresh interval and the actual lag. Cboe labels the feed
"Delayed Quotes" but states no duration anywhere on the page. **Sample it during a
live session before quoting a number to users.**

Caching layers on top: 5 min in-memory per chain (the Refresh button forces a
re-fetch), 120s at the worker edge.

## 6. Two bugs the live data exposed

**cmdk needs `CommandList`.** The contract picker rendered *zero* items because its
`CommandGroup` was not wrapped in `CommandList`, which cmdk 1.x requires. It was
invisible before only because the list was never populated with real data.

**Dates shifted by timezone.** `new Date("2026-08-21")` parses as UTC midnight, so
`getDate()` in any negative-offset timezone returns the 20th. Expirations displayed
a day early for US users. Fixed with a local-time parser (`parseISODate`) used
consistently on both the label and the days-to-expiry maths.

Also worth knowing: a full chain is ~2,000–5,000 contracts. Rendering all of them
into a combobox is unusable, so filtering and a 150-row cap live in the component,
with cmdk's own filtering disabled (`shouldFilter={false}`).

## 7. Deployment specifics for GitHub Pages

* `base` must match the repo path (`/optionsimulator/`), and the router `basename`
  must follow it — `import.meta.env.BASE_URL` keeps them in sync instead of the
  hardcoded `/member/` that was there before.
* The build entry must be `index.html`, because Pages serves that at a directory URL.
* `VITE_BASE=/member/ npm run build` still produces the gammalift member-area build.
* The deploy workflow is **manual trigger only** (`workflow_dispatch`) so a push
  cannot silently replace the live site.

## 8. Testing notes

Playwright against the real dev server caught what unit tests would have missed:
the empty contract list, the wrong base path, and the CORS failures in a genuine
browser. The proxy worker was tested by running its actual `fetch` handler inside a
small node http adapter — worth remembering that Workers code runs unmodified in
node 23, since `Request`/`Response`/`fetch` are all global there.

One harness trap: the adapter initially dropped request headers, which made the
origin allowlist look broken when it was fine. Verify the test harness before
trusting a negative result.
