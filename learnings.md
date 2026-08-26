# Learnings — live market data in a static options simulator

Notes from wiring online ticker search and live option chains into this app,
written down so the reasoning is not lost. Everything below was tested, not
assumed; dates and figures are from 2026-08-16 onward.

For the separate question of turning this into a subscription product — hosting,
auth, billing, and the two decisions that shape those — see
[building platform.md](building%20platform.md).

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

## 8. Building the insights page

**Cboe serves daily OHLCV too**, at `/api/global/delayed_quotes/charts/historical/
{SYMBOL}.json` — MSTR returns 5,691 bars back to 2004, keyless like the rest. That
is what makes realized volatility computable, and comparing it against implied is
the most useful thing on the page: it answers "are options expensive right now?",
which no single chain number does.

**Validating the maths against the source.** Independently computing ATM IV by
interpolating the smile at spot gave 65.82% where Cboe's own `iv30` field said
66.13% — a 0.3 vol point gap on a different horizon. Agreement that close means the
interpolation, the strike handling and the units are all right. Worth doing for any
derived metric where the provider also publishes its own version.

A second check that caught nothing but would have caught a lot: 25-delta skew is
**+1.26 vol points on SPX** and **−3.25 on MSTR**. Index options carry persistent
downside skew (crash protection) while high-beta single names skew to calls
(speculation), so the sign flip is the expected one. A metric that produces the
right sign on two known-opposite cases is probably wired correctly.

**Same-date series collide, again.** §7 was about strike + expiration not
identifying a *contract*; the same root cause bites analytics differently. On the
third Friday, SPX (AM-settled) and SPXW (PM-settled) both list — 499 strikes with
two contracts each. A strike-keyed map silently keeps whichever came last, and
summing open interest adds two different products together. `contractsFor` now
keeps one contract per strike per side, choosing the higher open interest.

**`<Routes>` in main.jsx shadowed the route table.** main.jsx wrapped the app in a
route list containing only the simulator paths, so `/insights` matched nothing and
rendered blank while every module compiled fine. Routing belongs in one place.

**Verifying React without a browser.** Playwright was not available this session.
Building the components with `vite build --ssr` and rendering them through
`renderToString` against a real Cboe payload exercised the full render path — 18
cases across the front week, a mid expiry and an 851-day LEAP. It catches exactly
the class of bug that unit-testing pure functions misses: a chart reaching into an
array that is empty for one expiration. It cannot catch layout or interaction.

## 9. There is no per-ticker implied-volatility history here

Wanted for IV Rank; not available. Every candidate endpoint on the free feed
returns 403 — `historical_iv`, `charts/iv`, `iv_history`, `volatility`,
`term_structure`. The delayed-quotes feed publishes today's IV and nothing else.

What *does* have history is the volatility **indices**, and they are keyless:

| Series | Bars | From |
| --- | --- | --- |
| `_VIX` | 9,251 | 1990 |
| `_VIX9D` / `_VIX3M` / `_VVIX` | 3,900–5,100 | 2006–2011 |
| `_VXAPL`, `_VXAZN` | 3,919 | 2011 — only a handful of single names |

Checked again on 2026-08-25 and the index list is healthier than expected: all
of `_VXAPL _VXAZN _VXGOG _VXIBM _VXGS _VXEEM _VXEWZ _VXFXI _VXGDX _VXSLV _VXTLT
_GVZ _OVX _VXN _RVX _VXD` are still published and still current (last bar the
previous session); `_VXXLE` died in 2022 and `_EVZ` in 2025. Each is a real
30-day implied-volatility series for its underlying, and the deployed worker
already allows the path, so charting them needs no `ALLOWED_PATHS` change.

**An IV-over-time panel was built on that and then removed the same day.** Worth
knowing why, because the idea will come back:

* For the ~20 underlyings above it plotted the real index. For every other
  ticker there is nothing to plot, so it drew an estimate — today's ATM IV
  scaled back through time by a 60/40 blend of the stock's own realized
  volatility and VIX. Anchored, dashed, and bannered as estimated, and its rank
  did land somewhere neither input did (MSTR: estimated IV rank 23 against
  realized 35).
* It came out anyway. A panel that is real data for AAPL and an inference for
  MSTR is two different charts wearing one title, and the names this app is
  actually used on are the ones with no index. Reconstructed history invites
  being read as recorded history no matter how it is labelled.

So the page keeps the two honest substitutes: the ticker's **realized**
volatility rank from its own closes, and **VIX** as the market-wide **implied**
rank. Charting real per-ticker IV needs a licensed feed (ORATS, marketdata.app,
Polygon) or saving this app's own IV reading daily until a year accumulates —
the second costs nothing but time, and is the route to revisit.

**Rank and percentile are different, and the difference matters.** Rank is
`(now − low) / (high − low)`, so one spike a year ago holds every later reading
down until it rolls out of the window. Percentile is the share of days that
closed below today, which uses the whole distribution. Measured live: KO sits at
rank 77.9 but percentile 89.7; MSTR at rank 12.2 but percentile 8.7. Both are
shown, because a single number would hide the disagreement.

**Comparing option prices across names needs a common sampling point.** Dollar
premiums are meaningless across underlyings, and so are equal strikes. The
comparison page samples each chain at the same delta (default) or the same
moneyness, at a similar time to expiry. Delta is the better default: equal
moneyness on a calm name and a volatile one picks options with very different
odds of paying out, while equal delta picks options the market considers equally
likely to finish in the money.

## 10. Comparing option prices across companies

Dollar premiums do not compare. A $9 option on a $95 stock and a $9 option on a
$300 stock are different trades, and so are two contracts picked at whatever
strikes happen to be listed. Each name has to be sampled at the *same point on
its own surface*.

**Delta is the better matcher, and it is the default.** Equal moneyness on a calm
name and a volatile one picks options with very different odds of paying out;
equal delta picks options the market considers equally likely to finish in the
money, which is closer to what "the same trade" means.

**"Expensive" has three different answers, so all three are reported.** Implied
volatility is the normalised price of volatility. Premium as a share of spot is
the cash cost. Breakeven move against implied move is what a directional buyer
feels. They disagree: measured live, KO was cheapest on IV *and* had its
breakeven furthest inside the expected range (0.73x against 0.87–0.90x for the
others) — a fact IV alone does not show.

**Beating the stock is a different bar from breaking even, and the direction of
the difference flips with the side.** Setting the option's return on capital
equal to the stock's return gives `S* = S0*K / (S0 - P)` for a call, with the
denominator becoming `S0 + P` for a put. For a call the shares are gaining too,
so the option must clear breakeven and keep going. For a put the shares are
losing, so the put beats them while still down on the trade: MSTR's 0.30 delta
put broke even at -11.8% but beat the stock at -11.3%. The first draft of that
column's help text asserted it was always the higher bar; a test that verified
both returns matched at the computed price is what caught it.

**Signed metrics need a separate ranking value.** The move columns are negative
for puts, so sorting descending on the raw number calls the smallest required
fall the most demanding. Ranking uses magnitude while the display stays signed.

## 11. Dealer gamma and vanna exposure

**The whole model rests on an assumption that the data cannot supply.** Open
interest records how many contracts exist; it never records who is long and who
is short. Every published gamma-exposure number — SqueezeMetrics, SpotGamma,
MenthorQ — closes that gap with a convention, the common one being that dealers
are long calls and short puts, because customers on balance buy puts for
protection and sell calls for yield. When that convention is wrong for a name,
the sign of the entire picture is wrong. It is exposed as a setting on the page
and stated above the numbers rather than buried as a constant.

**Greeks are recomputed rather than read from the feed.** The point of a gamma
profile is asking what exposure *would* be at a price other than today's, and
the feed only publishes greeks at today's. Vanna is not published at all:
`vanna = -phi(d1) * d2 / sigma`, derived from Black-Scholes.

Recomputation was cross-checked against the exchange's own published gamma on
SPY near the money — agreement within **1.5%**, the residual being the feed's
four-decimal rounding. Worth doing whenever a derived quantity has a published
counterpart; it catches unit and convention errors that eyeballing never will.

Units, chosen because "GEX" alone is meaningless: gamma exposure is **dollars of
delta per 1% move in spot**, vanna exposure is **dollars of delta per 1
volatility point**.

**The flip is found by sweeping, not by algebra.** Net exposure is recomputed
across a range of hypothetical spot prices and the zero crossing interpolated.
Verified on SPY: net gamma +$2.40B per 1% move, flip at $769.90, with the sign
genuinely reversing either side of it. Volatility is held fixed during the
sweep, which is the standard simplification and is worth naming — in reality
volatility rises as price falls, which pushes the true flip higher than the
curve shows.

**A heatmap is a layout problem, not a plotting one.** Expiration across, strike
down, colour diverging around zero: recharts has no heatmap primitive, and CSS
grid handles a dense matrix of labelled cells with a sticky axis better anyway.
Intensity scales with the *square root* of magnitude, because one or two strikes
dominate any chain and a linear scale leaves everything else invisible.

## 11b. Ranking every contract against a price view

The contract finder prices the whole chain against a target and sorts by return
on premium. Three things it taught, all discovered by looking at what it
surfaced rather than by reasoning ahead of time.

**At expiration, an implied-volatility view is worth nothing.** Only intrinsic
value is left, so `max(target − strike, 0)` against the ask is the entire
calculation — exact, no model. That is why the page carries a second column,
"if it happens now", which reprices through the binomial tree with time value
still on: it is the only place an IV assumption can bite. Ranking by the two
gives genuinely different lists, so both are offered and the difference is
stated rather than hidden.

**Sticky strike wrecks the "now" ranking, and the failure is loud.** Hold each
contract's own IV fixed and move spot toward its strike, and MSTR's $420 call —
quoted at 154% IV, four cents — reprices to about seventy cents at a target of
$152. A 1,600% return, on a contract worth exactly nothing at that same price at
expiry. The whole top twenty filled with those. The fix is sticky moneyness: a
contract that slides toward the money gives up its wing volatility on the way
in, so it is repriced at whatever *its new moneyness* is quoted at today, read
off the chain's own smile for that expiration. The IV view then shifts the whole
curve on top. Measured on the same contract: 1,601% → 906%.

**A smile read at a sliding strike must be cleaned first.** The lookup strike
moves continuously as the price axis moves, so one ragged IV point becomes a
spike in every return line that crosses it — the chart had a visible 400-point
spike before this. Two fixes together: drop strikes with no bid (a dead strike's
IV is whatever the exchange's model returned for a stale quote, and it sits well
off its neighbours' curve), then smooth what survives with a three-point kernel.

Related: contracts with no bid are excluded from the ranking entirely. An ask
nobody bids against is a quote, not a market, and 19 of MSTR's 1,072 candidates
were exactly that — including two in the top twenty.

## 11c. Saying whether a premium is rich, without arguing in a circle

**A model cannot tell you the market is wrong when the market told it what to
think.** Implied volatility is extracted from the premium: price a contract at
its own IV and the binomial tree hands back the price it started from, to the
cent, every single time. A rich/cheap verdict built on that comparison is
worthless, and it will look convincing while being worthless, which is worse.

Everything on the simulator's richness charts is measured against a **benchmark
volatility** instead, defaulting to the stock's realized volatility over the last
30 trading days — an independent measurement of how much it has actually been
moving — and exposed as a slider, because "what if I think vol is really 60%?"
is the question a trader actually has. A positive gap is the *normal* state,
since sellers charge for bearing risk, so the thresholds sit at 1.35 and 0.85
rather than at 1.

**The cell value is a dollar gap, not a ratio.** A ratio is unbounded where both
numbers are pennies: a two-cent contract worth one cent at the benchmark reads
as 100% rich and paints the entire out-of-the-money corner scarlet over a penny.
The dollar gap peaks near the money and near the front, which is where the money
is, and falls to zero at expiry where only intrinsic value is left and the two
volatilities agree by definition.

### Why this is three 2D charts and not one 3D one

The request was a 3D tunnel — price, time, premium, with layers for volatility.
It is worth writing down why that was argued out of rather than built.

* **`V(S, t)` is a surface, not a tunnel.** One premium per price/time pair. A
  tunnel only appears once volatility is a fourth axis, so the picture is 4D
  being drawn in 3D and the layers occlude each other.
* **The question is a 1D comparison over a 2D domain.** "Is this expensive" is
  one number — paid against benchmark — asked at every price and date. That is
  colour on a grid.
* **The surface was already on the page.** The Option Value Heatmap in
  `EvolutionChart` is exactly that price x time grid. A 3D render would have been
  the same data rotated into a form where occlusion and perspective make "is my
  point above or below the surface" — the literal question — unreliable by eye.

What replaced it: the same grid coloured by *overpay* rather than by value, with
the scenario's path ringed through it; the textbook family of value-vs-price
curves drawn twice, at implied and at the benchmark, so the space between them is
the premium as a shape; and a histogram of every 30-day volatility the stock has
delivered with a line at what is being paid, which turns the whole question into
a percentile a person can act on.

### Two bugs that only show in a difference

**Binomial trees have a sawtooth, and subtracting two of them exposes it.** A
tree of fixed depth prices a step function of spot — its terminal nodes sit on
discrete prices, and whether the strike lands on a node or between two shifts the
answer slightly. Invisible in a price. Very visible in a gap a tenth its size:
the overpay curves came out looking like staircases. Deepening the tree barely
helps and costs enormously — 300 steps took 1.6 seconds and was still rougher
than the fix. Averaging depths `n` and `n+1` puts the two halves of the
oscillation against each other and cut the roughness threefold for twice the
work, at 72ms for the whole chart.

**`toISOString` is the wrong way to get a calendar date.** It converts to UTC
first, so local midnight anywhere ahead of UTC lands on the previous day. In CEST
the grid's entire date axis was labelled one day early, today's column reading as
yesterday. `optionAnalytics` already had `toLocalISODate` for this reason; the
new module had to grow its own. Build the string from `getFullYear`/`getMonth`/
`getDate` and never from `toISOString`.

## 11d. A chart and the table beside it must agree to the decimal

Both of this session's new charts report a number that also appears as text
nearby, and both were quietly off. Neither was visible without going looking.

**A number the table states must be an exact point on the chart's axis.** The
return chart's grid was 61 evenly spaced points across the range; a +50% view
fell between two of them, so the nearest drawn point was +50.67% and every line
sat about a percent away from the row beside it. Fix: force the marked value onto
the axis as its own point, and draw a dot there.

**Resolution has to match at that point too.** The chart priced with a 60-step
binomial tree for speed and the table with 100, which was worth another point of
disagreement. The marked point alone is now priced at full resolution — one extra
tree per line, invisible in the timings, and the two agree exactly.

**Say which point the table reads.** "Best return 46%" against a line reaching
+80% looks like a contradiction until you notice the axis deliberately runs to
1.6× the view on both sides. The reference line now says so in words.

The general shape: any figure that appears both as text and as geometry needs the
geometry to contain the exact text value, at the same precision, and to say where.

## 11e. When a screen returns few rows, say where the rest went

ASST over 330-514 days screens 13 contracts and there is nothing wrong with that:
the chain lists exactly one expiration in that window, and 72 of the 106 rows it
does list there are adjusted series that this app excludes everywhere. The page
showed the 13 and said nothing, which reads as a bug.

Every stage of the funnel is now counted inside `screenContracts` and stated in a
sentence under the verdict. The lesson generalises past this page: a filter that
silently removes most of the input is indistinguishable from a broken filter, and
the count that explains it is nearly free to carry — it is the same loop.

Adjusted contracts needed counting in `normalizeChain` too, since they are dropped
before the screener ever sees the chain and so can never appear in its funnel. On
a name like ASST their absence *is* the question a user is asking.

## 12. Deployment specifics for GitHub Pages

* `base` must match the repo path (`/optionsimulator/`), and the router `basename`
  must follow it — `import.meta.env.BASE_URL` keeps them in sync instead of the
  hardcoded `/member/` that was there before.
* The build entry must be `index.html`, because Pages serves that at a directory URL.
* `VITE_BASE=/member/ npm run build` still produces the gammalift member-area build.
* The deploy workflow is **manual trigger only** (`workflow_dispatch`) so a push
  cannot silently replace the live site.

## 13. Testing notes

Playwright against the real dev server caught what unit tests would have missed:
the empty contract list, the wrong base path, and the CORS failures in a genuine
browser. The proxy worker was tested by running its actual `fetch` handler inside a
small node http adapter — worth remembering that Workers code runs unmodified in
node 23, since `Request`/`Response`/`fetch` are all global there.

One harness trap: the adapter initially dropped request headers, which made the
origin allowlist look broken when it was fine. Verify the test harness before
trusting a negative result. A second one: a hand-rolled `window` stub made React
take the browser path and crash with `target.addEventListener is not a function`.
Leaving `window` undefined was correct — the code under test already falls back
to memory when storage is missing.

**"It compiles" is not evidence that it renders.** A mount effect referenced a
`const` declared 170 lines below it. Dependency arrays are evaluated *during*
render, so the reference hit the temporal dead zone and threw on every render,
blanking the whole app — while `vite build` exited 0 and ESLint stayed silent.
It shipped because the verification for that change tested pure functions that
had nothing to do with the crash.

The fix at the time was a page-mount pass: render each page inside a
`MemoryRouter` through `renderToString` across a spread of URLs, proven to have
teeth by reinstating the bug and watching it fail. **It was never committed — no
such script exists in this repo, and the claim that it "runs before every deploy"
was wrong for every deploy after the one that wrote it.** Worth knowing before
relying on it.

What is actually used now, and what caught real bugs on 2026-08-25 and -26, is
Playwright against the dev server: navigate each page with the query string that
sets up the case, then assert on rendered output — `table tbody tr` counts,
`.recharts-line` counts, axis tick text, the verdict sentence — with
`pageerror` and `console` collected the whole time. It sees everything the mount
pass could not: data-gated tables, portal content, axis rounding, and layout
(measure the table's `boundingBox` against its pane to prove it does not
overflow). The same script pointed at the live URL is the post-deploy check.

Playwright is not in this repo's dependencies; `npm i playwright` in a scratch
directory outside the project is enough, and keeps the app's lockfile clean.

## 14. Deploying the worker (Cloudflare dashboard)

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

## 15. Publishing, as actually performed

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

**A correct artifact can still fail to publish.** On 2026-08-17 `gh-pages` held
the right commit with a correct tree while the site served the previous bundle
for a quarter of an hour. GitHub's own Pages workflow had failed three times
downloading `actions/deploy-pages` from codeload.github.com — `429 Too Many
Requests`, then an internal server error. The distinguishing sign is
`last-modified` on the live index not moving; the response to it is to re-run,
never to rebuild. Time spent verifying the artifact was wasted, though checking
the tree was the right first move.

**SSH gotcha:** port 22 to github.com returns *Connection refused* on this machine.
It first appeared mid-session having worked minutes earlier, and has recurred every
session since, so treat it as the normal state rather than a blip. GitHub's
alternate endpoint works and uses the same key:

```bash
git push -f ssh://git@ssh.github.com:443/enea-denkt/optionsimulator.git HEAD:gh-pages
```

## 16. Still open

* **Cboe's terms (§4) are now being exercised in production**, not in testing. The
  IP-block risk is real rather than theoretical; migrating to a licensed feed
  touches only the worker's upstream and one normalizer in `marketData.js`.
* **The Actions deploy route has never been exercised.** Whether the `MARKET_PROXY`
  repo variable is set is *unknown and not checkable from this machine* — `gh` is
  unauthenticated. Deploys run locally, which does not depend on it.
* **Feed cadence during market hours is still unmeasured** (§5).
* **No committed test harness.** Verification is a Playwright script written per
  session in a scratch directory (§13). Committing a small page-mount or
  page-render check would make it repeatable; nothing does it today.
* **Three unreferenced `* backup.jsx` files** — `EvolutionChart backup`,
  `MetricsSummary backup` and `pages/OptionsSimulator backup` — are compiled into
  nothing, but each still carries its own copy of the binomial tree. Grep for the
  pricer and they are what you find. Deleting them is a one-line change nobody
  has made.

  Counting copies is how the live one in `MetricsSummary.jsx` turned up on
  2026-08-26: fifty lines of binomial tree that nothing ever called, sitting in a
  file that only formats numbers. Consolidating on a shared module is what made
  it visible — the grep that proves the rule holds is also the grep that finds
  dead code.
* The stock-return benchmark shares one Y axis with the option's net return. That
  is correct — same units — but when the option returns thousands of percent the
  stock line flattens visually. A log-scale toggle would be the fix if it matters.
  The contract finder's return chart has the same property, more acutely.
* **The finder ranks return, never probability.** The top of any such list is the
  contract that needs you to be most exactly right; delta sits in the next column
  as the market's own odds, but nothing weights by it. A probability-weighted
  ranking is a different and defensible page, and does not exist yet.
