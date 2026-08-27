# CLAUDE.md — optionsimulator

Operational instructions for this repo. The *reasoning* behind these choices is in
[learnings.md](learnings.md); this file is the "what to run" so it never has to be
re-derived or guessed. Plans for turning this into a subscription product live in
[building platform.md](building%20platform.md) — none of it is built yet, so
nothing in this file assumes it.

## Repo facts

| | |
| --- | --- |
| GitHub repo | `enea-denkt/optionsimulator` |
| Remote name | `enea` |
| Source branch | `main` |
| **Branch the live site serves** | **`gh-pages`** |
| Live URL | https://enea-denkt.github.io/optionsimulator/ |
| Market-data worker | https://market-proxy.enea-denkt.workers.dev |

**Pushing to `main` does not change the live site.** `main` is source only. The
site is whatever `gh-pages` contains. These two are updated separately and drift
apart routinely — always state which one you changed.

## What the app contains

A multi-page dashboard, not a single tool. Routes live in `src/pages/index.jsx`;
the menu is the `NAV_ITEMS` array in `src/pages/Layout.jsx`.

| Route | Page | What it answers |
| --- | --- | --- |
| `/` | Options Simulator | How does this position behave under a scenario, and is the premium rich or cheap? |
| `/insights` | Chain Insights | What is the chain pricing for one name? |
| `/finder` | Contract Finder | Which contract pays best if my view comes true? |
| `/compare` | Compare Companies | Which of these names has the expensive options? |
| `/exposure` | Dealer Exposure | Where do hedging flows pin or accelerate price? |

The table is in menu order — `NAV_ITEMS` puts the finder third.

Shared building blocks, all pure and node-testable:

| Module | Holds |
| --- | --- |
| `src/api/marketData.js` | every network call; chains, quotes, price history, symbol search |
| `src/lib/optionAnalytics.js` | smile, term structure, max pain, expected move, realized vol |
| `src/lib/volatilityHistory.js` | rank and percentile, rolling series, VIX helpers, chart range windows |
| `src/lib/optionComparison.js` | cross-name contract matching and the comparison metrics |
| `src/lib/gammaExposure.js` | Black-Scholes gamma and vanna, dealer exposure, gamma flip |
| `src/lib/contractScreener.js` | the binomial pricer, chain-wide scenario ranking, return curves |
| `src/lib/chartScale.js` | axis bounds and ticks that read like numbers a person would pick |
| `src/lib/useUrlState.js` | query-string state, shared by every page |
| `src/lib/tickerMemory.js` | the ticker carried between pages for the session |

Shared **components** worth reaching for before writing a new one:

| Component | What it is, and where it is already used |
| --- | --- |
| `insights/InsightCard.jsx` | the frame every chart sits in: title, computed verdict sentence, action slot, footnote |
| `insights/MetricTile.jsx` | one labelled number with a hint line, in four tones |
| `insights/RangeToggle.jsx` | the 3M/6M/1Y/2Y/5Y span selector; drop it in any chart's `action` slot and share one URL value across the page |
| `screener/ResultsTable.jsx` | ranked contract table; `compact` drops secondary columns onto the row's hover title so two fit side by side, `startRank`/`descending` number a slice from either end |
| `screener/ReturnCurveChart.jsx` | return against underlying move, with the Tableau 20 palette exported as `TABLEAU_20` |
| `ui/slider.jsx` | shadcn slider, **now one thumb per value** — pass two and it is a range slider |

`chartScale.js`'s `niceAxis(low, high, { floorAt })` is the answer whenever an
axis prints numbers like `−89,947%`: pick the step, place ticks on multiples of
it, hand recharts both. `floorAt` pins a bound the data cannot cross (0 for a
premium, −100% for an option's return) so only the top rounds outward.

## SSH: port 22 is refused on this machine

`git push enea main` fails with `ssh: connect to host github.com port 22:
Connection refused`. This has recurred across sessions; it is not transient.
Use GitHub's 443 endpoint, which uses the same key and identity:

```bash
git push ssh://git@ssh.github.com:443/enea-denkt/optionsimulator.git main
```

## Deploying to the live site

**Use the local build + force-push route.** This is what has actually been used for
every deploy so far. Do not switch to the Actions route without being asked.

```bash
cd "/Users/lucadeangelis/github/Gammalift Option Simulator"

# 1. Build with the worker URL. Without VITE_MARKET_PROXY the app silently falls
#    back to public CORS proxies and the live site's data breaks.
rm -rf dist
VITE_MARKET_PROXY=https://market-proxy.enea-denkt.workers.dev npm run build

# 2. Check the artifact BEFORE publishing — a missing worker URL is the one
#    failure that looks fine locally and breaks in production.
grep -oh 'market-proxy[^"]*workers\.dev' dist/assets/*.js   # must print the URL

# 3. Publish.
cd dist
touch .nojekyll
git init -q
git config user.name "lucadeangelisas24"
git config user.email "luca.deangelis@satyadata.com"
git add -A
git commit -q -m "Deploy $(git -C .. rev-parse --short HEAD)"
git push -f ssh://git@ssh.github.com:443/enea-denkt/optionsimulator.git HEAD:gh-pages
```

### Verifying a deploy

GitHub Pages takes ~20–30s. Do not report success without checking the *served*
bundle — confirm a string that only exists in the new code:

```bash
curl -s https://enea-denkt.github.io/optionsimulator/ -o /tmp/live.html
JS=$(grep -o 'assets/[^"]*\.js' /tmp/live.html | head -1)
curl -s "https://enea-denkt.github.io/optionsimulator/$JS" | grep -c '<new-symbol>'
```

**The symbol has to be new in *this* change, not merely present.** Grepping for a
string that the previous bundle already contained reports success against the old
bundle and the deploy looks finished when Pages has not published yet — this
happened on 2026-08-25. The bundle filename changing is the other tell: if
`assets/main-*.js` is the same hash as before the push, nothing has been
published. Minified output is a poor place to look for a marker, so prefer a
user-visible string; JSX props survive as `max:500`, comments do not survive at
all, and identifiers are renamed.

Publishing takes 20-60s in practice, sometimes two or three polls.

### Rollback

```bash
git push -f ssh://git@ssh.github.com:443/enea-denkt/optionsimulator.git <sha>:gh-pages
```

Deploy history (`gh-pages` sha → built from `main` sha):

* `0585554` → `a2e0767` — 2026-08-16, first deploy
* `7827352` → `3821285` — 2026-08-17, OCC-symbol contract identity
* `b34f8ad` → `195e22a` — 2026-08-25, implied-vol history and chart range windows
  (replaced `948f312`, a deploy that predates this list)
* `f75c8ea` → `e57c198` — 2026-08-25, implied-vol panel removed again
* `9500482` → `e68422c` — 2026-08-25, contract finder page
* `322ecdf` → `6a505a8` — 2026-08-25, bottom-20 table beside the top
* `0efeb0d` → `633c004` — 2026-08-25, screening funnel explained on the page
* `dd4aa21` → `a1313f3` — 2026-08-25, chart marks the point the table reports
* `7bdca20` → `979f3ce` — 2026-08-25, price view to +500%, fitted return axis
* `a9c0c0a` → `18091c3` — 2026-08-25, premium bands and the rich/cheap reading
* `640fde8` → `501844d` — 2026-08-26, richness map, decay curves, vol distribution

## When gh-pages is right but the site is stale

Symptom: `gh-pages` holds the commit you just pushed, the tree is correct, and
the live site still serves the previous bundle.

**That is a publish failure, not a build problem. Do not rebuild.** The tell is
`last-modified` on the live index not moving:

```bash
curl -s -D - -o /dev/null https://enea-denkt.github.io/optionsimulator/ | grep -i last-modified
```

**Check <https://www.githubstatus.com/api/v2/summary.json> before retrying.** It
answers in one request whether this is yours to fix, and the answer is often no —
Pages publishing runs on Actions, so an Actions incident stops deploys dead while
`gh-pages` sits there looking perfect.

**Wait for Pages to read `operational` before pushing a retry.** Retries issued
mid-outage are wasted: on 2026-08-26 three of them vanished, and the deploy
published ninety seconds after a fourth push made once Pages recovered — so the
jobs queued during the outage were dropped, not delayed.

```bash
curl -s https://www.githubstatus.com/api/v2/summary.json \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['status']['description']); \
    [print(c['name'], '->', c['status']) for c in d['components'] if c['name'] in ('Pages','Actions')]"
```

Seen on 2026-08-17: GitHub's own `pages build and deployment` workflow failed
three times because it could not download `actions/deploy-pages` from
codeload.github.com — `429 Too Many Requests`, then an internal server error.
Nothing was wrong with the artifact.

Seen again on 2026-08-26, and this one is the reason the status check is now the
first step: a deploy pushed at 15:10 UTC never published. `gh-pages` held the
right tree, `.nojekyll` and `404.html` were present, `index.html` named the new
bundle, and the bundle 404'd on the live site with `age: 0`, ruling out CDN
caching. Three empty-commit retries over thirty minutes did nothing. GitHub had
opened an incident at 15:11 UTC — Actions in major outage, Pages degraded, a
database primary failing over. **Retrying cannot fix a platform outage; it just
adds commits.** One request to the status API would have said so in the first
minute.

The fix is to run it again: any push to `gh-pages` (an empty commit is enough) or
"Re-run all jobs" in the Actions tab. It cleared about fifteen minutes later.

```bash
cd dist && git commit --allow-empty -m "Retry Pages publish" \
  && git push -f ssh://git@ssh.github.com:443/enea-denkt/optionsimulator.git HEAD:gh-pages
```

## Which route was used for a past deploy

Read the `gh-pages` commit author. **The author identifies the route** — this is
the fastest way to answer "did I deploy via Actions?" and it needs no `gh` auth:

```bash
git fetch ssh://git@ssh.github.com:443/enea-denkt/optionsimulator.git gh-pages
git log -1 --format='%an %s' FETCH_HEAD
```

* `lucadeangelisas24` → local build + force-push
* `github-actions[bot]` → the workflow ran

## The GitHub Actions route (not currently used)

`.github/workflows/deploy.yml` exists and is **`workflow_dispatch` only** on
purpose, so a push cannot silently replace the live site.

It requires the repo variable `MARKET_PROXY` (Settings → Secrets and variables →
Actions → Variables) set to the worker URL. **Without it the build succeeds and
the live site's data breaks.**

**Do not claim whether that variable is set — it cannot be read from here.** `gh`
is not authenticated on this machine (`gh variable list` returns "please run
`gh auth login`"). As of 2026-08-17 its state is *unverified*. It is irrelevant to
the local build route above, which passes the URL on the command line.

**`gh auth login` cannot be run from this session.** The `--web` flow needs a TTY
to prompt before opening a browser; with no TTY it hangs silently without even
printing the one-time code. The user has to run it in their own terminal.

**Always ask which GitHub account first.** Several identities exist on this
machine and the right one varies by repo — `enea-denkt` here, others elsewhere.
The browser flow silently adopts whatever account the browser session holds, and
HTTPS remotes on this machine default to a different account.

## Hosting on Cloudflare Pages, behind a login

GitHub Pages cannot do what this app now needs. A Pages site stays **publicly
readable even when its repository is private** — GitHub Pro ($4/mo) buys the
private repo and nothing else; gating the site itself is GitHub Enterprise Cloud
only. Cloudflare Pages hosts private repos free and Cloudflare Access puts a real
login in front, free up to 50 users.

**The repo side is done.** What is left is dashboard work that cannot be scripted
from here.

### What is already in the repo

| Piece | Why |
| --- | --- |
| `functions/cboe/[[path]].js` | the Cboe pass-through, running on the app's **own origin** |
| `public/_redirects` | client-side routing: `/finder` must be answered with index.html at status 200 |
| `npm run build:cloudflare` | `VITE_BASE=/ VITE_MARKET_PROXY=/cboe vite build` |

**The proxy is same-origin on purpose, and it is the whole security design.**
Access gates a *hostname*. With the proxy on `market-proxy.<account>.workers.dev`
the app would be locked and the data pipe feeding it would still be open to
anyone with the URL — authenticating the UI while leaving the API open protects
nothing. Served from `/cboe/*` on the app's own hostname, every data request is
already authenticated before the function runs: no JWT to verify, no CORS, no
`Origin` allowlist to forge. Verified in a browser against `wrangler pages dev`:
all three pages load live data and **every request is same-origin**.

The build variables are baked into the script rather than left to the dashboard,
because a forgotten `VITE_MARKET_PROXY` is the one failure that builds cleanly
and breaks production silently.

### Dashboard steps (nobody can do these from a terminal)

1. **Make the repo private** — GitHub → Settings → General → Danger Zone.
2. **Cloudflare → Workers & Pages → Create → Pages → Connect to Git**, pick the
   repo. Build command `npm run build:cloudflare`, output directory `dist`.
   Leave the environment variables empty; the script sets them.
3. Deploy, and confirm on the `*.pages.dev` URL that a deep link such as
   `/finder?ticker=MSTR` loads with data before going any further.
4. **Zero Trust → Access → Applications → Add → Self-hosted.** Point it at the
   Pages hostname. Add a policy: action Allow, include *Emails* and list them.
   Login method **One-time PIN** needs no identity provider; Google or GitHub
   also work.
5. Set the session duration on that application — that is your "sessions", and
   Access renews the signed cookie itself. Nothing to build.
6. **Retire the standalone worker** once nothing points at it. While it exists it
   is a public, unauthenticated copy of the same data pipe, protected only by its
   path allowlist and a forgeable `Origin` check.

### Three traps

* **`404.html` shadows `_redirects`.** `npm run build` copies index.html to
  404.html for GitHub Pages; on Cloudflare that file wins the fallback and every
  deep route answers **200-with-a-404-status**, which renders fine and is wrong.
  `build:cloudflare` simply never creates it. Do not use plain `build` there.
* **`ALLOWED_PATHS` now lives in two files** — `functions/cboe/[[path]].js` and
  `proxy/cloudflare-worker.js`. They cannot share a module, because the worker is
  deployed by pasting a single self-contained file into the dashboard. Adding a
  Cboe endpoint means editing both.
* **Access gates the origin, not the bundle's contents.** This is a real login,
  unlike anything bolted into the React app: a static site's JS is a public file,
  so an in-app login would hide the UI while anyone could download `main-*.js`
  and run it. Access refuses the file itself.

### Testing it locally

```bash
npm run build:cloudflare
npx wrangler pages dev dist --port 8788 --compatibility-date=2026-08-01
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8788/finder            # 200, not 404
curl -s "http://localhost:8788/cboe/api/global/delayed_quotes/options/MSTR.json" | head -c 80
```

## The worker must be redeployed when ALLOWED_PATHS changes

`proxy/cloudflare-worker.js` lives in this repo but **runs on Cloudflare**, so
editing it here changes nothing in production. Adding a Cboe endpoint means
adding a regex to `ALLOWED_PATHS` *and* re-pasting the file into the Cloudflare
dashboard (Workers & Pages → the worker → Edit code → Deploy).

Dev hides this: the Vite proxy forwards any `/cboe/*` path, so a new endpoint
works locally while 404ing on the live site. Check the deployed worker directly:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://enea-denkt.github.io" \
  "https://market-proxy.enea-denkt.workers.dev/api/global/delayed_quotes/charts/historical/MSTR.json"
```

404 means the deployed worker predates the current `ALLOWED_PATHS`.

## Adding a page

Routes live in `src/pages/index.jsx`; the menu is the `NAV_ITEMS` array in
`src/pages/Layout.jsx`, which feeds both the desktop bar and the mobile sheet.

**Do not add a `<Routes>` block to `src/main.jsx`.** It wraps the app and a route
table there shadows the real one, so a new page renders nothing. `main.jsx` should
only supply `BrowserRouter` and the basename.

GitHub Pages has no server-side routing, so `npm run build` copies `index.html` to
`404.html`. That is what lets `/optionsimulator/insights` load on a direct visit or
a refresh instead of 404ing. Keep that step in the build script.

**Every page keeps its controls in the URL**, so any view can be shared by copying
the address bar. Use `useUrlState` from `src/lib/useUrlState.js` instead of
`useState` for whatever the user can change:

```js
const URL_SPEC = { ticker: asString(''), dte: { ...asNumber(90), param: 'dte' } };
const [state, setState] = useUrlState(URL_SPEC, DEFAULTS);
```

Rules that keep shared links working:

* **Put inputs in the URL, not derived values.** The simulator carries the OCC
  symbol and re-reads strike, premium and IV from the live chain on load, so a
  link opened next week shows current quotes rather than stale ones.
* **Fetch on mount from the URL value, and do not clobber it.** A page that
  resets its selection after loading data will throw away what the link carried;
  `loadChain(..., { preserveSelection: true })` in OptionsFilters is the pattern.
* Codecs (`asString`, `asNumber`, `asNullableNumber`, `asBoolean`, `asEnum`) fall
  back to the default when a value is unusable, so a hand-edited URL cannot push
  `NaN` into state. `asEnum` is the safe choice for anything with fixed options.
* Values equal to the default are omitted, writes are debounced and use
  `replace`, and unrelated params (`utm_source`, …) survive.

`hydrateFromParams` and `serializeToParams` are exported as pure functions — test
URL behaviour against those rather than trying to drive the hook.

## Market data

All access is isolated in `src/api/marketData.js`. Two things that are easy to get
wrong and have already caused bugs:

* **A contract's identity is its OCC symbol**, never `strike + expiration` — those
  collide across series (`ASST`/`ASST1`/`ASST2`, and `SPX`/`SPXW`). Look contracts
  up with `findContractByOcc(chain, occSymbol)`.
* **There is no historical implied volatility for a ticker.** The chain serves
  today's IV and nothing older, and every historical-IV endpoint 403s — verified
  again on 2026-08-25. Do not add a per-ticker IV-over-time chart without a real
  source behind it; one was built and removed the same day. See learnings.md.
* **One binomial pricer serves the whole app**, exported as `americanOptionPrice`
  from `src/lib/contractScreener.js`. Every live caller imports it — the simulator
  page, `EvolutionChart`, `premiumBands` and the finder. The only remaining
  copies are inside the three unreferenced `* backup.jsx` files. Do not add another: a contract that is worth one number on one page and another on the
  next is worse than either being wrong.
* **Adjusted series are filtered out** in `normalizeChain`, because the binomial
  model assumes 100 ordinary shares per contract. Adjusted roots end in a *digit*
  (`ASST1`); a trailing *letter* (`SPXW`, `NDXP`) is an ordinary separate series and
  must be kept. See learnings.md §7.

## Local development

```bash
npm run dev     # http://localhost:5173/optionsimulator/
```

The Vite dev proxy (`/cboe` → `cdn.cboe.com`, see `vite.config.js`) stands in for
the worker locally, so `VITE_MARKET_PROXY` is not needed in dev.

`npm run lint` reports ~60 pre-existing `react/prop-types` errors. Compare counts
before and after a change rather than expecting zero.
