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

**A third, self-inflicted one:** a JSX comment (`{/* … */}`) placed directly inside
`ReactDOM.createRoot(...).render(` is a syntax error — `render()` takes one
expression, and `{…}` is only valid among JSX *children*. Use a plain `//` comment
above the element instead. Vite's error overlay also persists after the fix until
the page is reloaded, which makes a corrected file look broken.

## 7. Strike + expiration does not identify a contract

Found through ASST, which lists **three** 15-strike Jan-2028 calls. They differ by
OCC *root*: `ASST`, `ASST1`, `ASST2`. A corporate action (ASST's split) changes what
one contract delivers; OCC leaves the old contracts trading under a new root with a
digit appended, and the strike and expiration stay the same.

How different they are, from put–call parity across every two-sided pair
(`S* = C − P + K·e^(−rT)`, spot $12.36):

| Root | Contracts | Implied deliverable | vs spot |
| --- | --- | --- | --- |
| `ASST` | 758 | $12.23 | 0.99× — standard, 100 shares |
| `ASST1` | 88 | $12.73 | 1.03× |
| `ASST2` | 102 | $0.50 | **0.04×** |

Hence a 15-strike call marking $5.08 on one root and $0.03 on another.

The app keyed contracts on `"strike - expiration"`, so all three collapsed into one
identity and produced three separate symptoms:

* `availableContracts.find(...)` returned the **first** match — clicking `ASST2`
  loaded `ASST`'s premium
* the tick compared `selectedContract === contract.label`, so **all three rows
  showed as selected**
* `key={contract.value}` gave React duplicate keys, and Refresh re-priced by
  strike + expiration, so it could silently swap series between refreshes

**Fix: the OCC symbol is the only unique identity a contract has.** The chain now
carries a `bySymbol` index, `findContractQuote(chain, type, strike, expiration)`
became `findContractByOcc(chain, occSymbol)`, and selection, React keys, the tick
and the refresh path all key on it.

**Digit vs letter matters.** Adjusted roots append a *digit* (`ASST1`); ordinary
separate series append a *letter* (`SPXW`, `NDXP`). Only the first is an adjustment,
so the test is `root !== symbol && root.startsWith(symbol) && /\d$/.test(root)`.
Worth knowing: **SPX and SPXW collide on strike + expiration too** (AM- vs
PM-settled), so the same bug was live on every index chain and was never noticed.
Non-standard roots that are *not* adjustments are kept, with the root in the label.

Adjusted series are **dropped in `normalizeChain`** rather than shown. The binomial
model prices `max(S − K, 0)` per share and assumes 100 ordinary shares, so on
`ASST2` every downstream number would be off by ~25×. The premium and IV would be
real and everything derived from them wrong — worse than not offering them. They are
barely tradeable anyway (0 volume across the board). ASST drops 888 → 734 contracts.

## 8. Deployment specifics for GitHub Pages

* `base` must match the repo path (`/optionsimulator/`), and the router `basename`
  must follow it — `import.meta.env.BASE_URL` keeps them in sync instead of the
  hardcoded `/member/` that was there before.
* The build entry must be `index.html`, because Pages serves that at a directory URL.
* `VITE_BASE=/member/ npm run build` still produces the gammalift member-area build.
* The deploy workflow is **manual trigger only** (`workflow_dispatch`) so a push
  cannot silently replace the live site.

## 9. Testing notes

Playwright against the real dev server caught what unit tests would have missed:
the empty contract list, the wrong base path, and the CORS failures in a genuine
browser. The proxy worker was tested by running its actual `fetch` handler inside a
small node http adapter — worth remembering that Workers code runs unmodified in
node 23, since `Request`/`Response`/`fetch` are all global there.

One harness trap: the adapter initially dropped request headers, which made the
origin allowlist look broken when it was fine. Verify the test harness before
trusting a negative result.

## 10. Deploying the worker (Cloudflare dashboard)

Workers & Pages → Create → **"Start with Hello World!"**. The neighbouring options
are both wrong for this: *Connect GitHub* tries to build the whole Vite app and
would need a `wrangler.toml` to know that one file under `proxy/` is the worker,
and *Upload your static files* is Cloudflare Pages, which does not run server-side
code at all. Deploy the placeholder, then Edit code, delete the template entirely,
paste `proxy/cloudflare-worker.js`, deploy again.

Live at **https://market-proxy.enea-denkt.workers.dev**. Verified against it:

| Check | Result |
| --- | --- |
| Allowed origin (`enea-denkt.github.io`) | 200, correct `Access-Control-Allow-Origin` |
| Foreign origin | 403, no CORS header |
| Path outside the allowlist | 404 |
| CORS preflight | 204 |
| 1.4MB option chain | 200 in 0.47s |
| 2.3MB symbol directory | 200 in 6.5s (uncached first hit) |

The symbol directory is the slow one, which is why it is fetched lazily on the
first search and kept in memory rather than re-fetched per keystroke.

## 11. Publishing, as actually performed

GitHub Pages serves the **`gh-pages` branch**. Pushing source to `main` changes
nothing on the live site — that surprise is worth remembering.

The first deploy was done by building locally against the live worker and
force-pushing `dist` to `gh-pages`, which is exactly what the workflow does. The
Actions route additionally needs the `MARKET_PROXY` repo variable set
(Settings → Secrets and variables → Actions → Variables); **without it the build
silently falls back to the public proxies and the live site's data breaks.**

Every deploy so far has used the local route. Runbook lives in
[CLAUDE.md](CLAUDE.md) so it does not have to be reconstructed each time.

| `gh-pages` | built from `main` | date |
| --- | --- | --- |
| `0585554` | `a2e0767` | 2026-08-16 |
| `7827352` | `3821285` | 2026-08-17 |

**Rollback:** `git push -f <remote> <older-gh-pages-sha>:gh-pages`

**How to tell which route a past deploy used, without `gh` auth:** read the
`gh-pages` commit author. The workflow commits as `github-actions[bot]`; a local
force-push carries your own name. That single field settles the question — worth
knowing because `gh` is *not* authenticated on this machine, so repo variables and
workflow runs cannot be inspected at all. Do not assert the state of the
`MARKET_PROXY` variable from memory; it is unverifiable from here.

**SSH gotcha:** port 22 to github.com returns *Connection refused* on this machine.
It first appeared mid-session having worked minutes earlier, and has recurred every
session since, so treat it as the normal state rather than a blip. GitHub's
alternate endpoint works and uses the same key:

```bash
git push -f ssh://git@ssh.github.com:443/enea-denkt/optionsimulator.git HEAD:gh-pages
```

## 12. Still open

* **Cboe's terms (§4) are now being exercised in production**, not in testing. The
  IP-block risk is real rather than theoretical; migrating to a licensed feed
  touches only the worker's upstream and one normalizer in `marketData.js`.
* **The Actions deploy route has never been exercised.** Whether the `MARKET_PROXY`
  repo variable is set is *unknown and not checkable from this machine* — `gh` is
  unauthenticated. Deploys run locally, which does not depend on it.
* **Feed cadence during market hours is still unmeasured** (§5).
* The stock-return benchmark shares one Y axis with the option's net return. That
  is correct — same units — but when the option returns thousands of percent the
  stock line flattens visually. A log-scale toggle would be the fix if it matters.
