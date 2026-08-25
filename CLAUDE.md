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
| `/` | Options Simulator | How does this position behave under a scenario? |
| `/insights` | Chain Insights | What is the chain pricing for one name? |
| `/compare` | Compare Companies | Which of these names has the expensive options? |
| `/exposure` | Dealer Exposure | Where do hedging flows pin or accelerate price? |
| `/finder` | Contract Finder | Which contract pays best if my view comes true? |

Shared building blocks, all pure and node-testable:

| Module | Holds |
| --- | --- |
| `src/api/marketData.js` | every network call; chains, quotes, price history, symbol search |
| `src/lib/optionAnalytics.js` | smile, term structure, max pain, expected move, realized vol |
| `src/lib/volatilityHistory.js` | rank and percentile, rolling series, VIX helpers, chart range windows |
| `src/lib/optionComparison.js` | cross-name contract matching and the comparison metrics |
| `src/lib/gammaExposure.js` | Black-Scholes gamma and vanna, dealer exposure, gamma flip |
| `src/lib/contractScreener.js` | the binomial pricer, chain-wide scenario ranking, return curves |
| `src/lib/useUrlState.js` | query-string state, shared by every page |
| `src/lib/tickerMemory.js` | the ticker carried between pages for the session |

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

## When gh-pages is right but the site is stale

Symptom: `gh-pages` holds the commit you just pushed, the tree is correct, and
the live site still serves the previous bundle.

**That is a publish failure, not a build problem. Do not rebuild.** The tell is
`last-modified` on the live index not moving:

```bash
curl -s -D - -o /dev/null https://enea-denkt.github.io/optionsimulator/ | grep -i last-modified
```

Seen on 2026-08-17: GitHub's own `pages build and deployment` workflow failed
three times because it could not download `actions/deploy-pages` from
codeload.github.com — `429 Too Many Requests`, then an internal server error.
Nothing was wrong with the artifact.

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
  from `src/lib/contractScreener.js`. The simulator imports it. Do not add a
  second one: a contract that is worth one number on one page and another on the
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
