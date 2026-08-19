# Building the platform — turning the dashboard into a SaaS

Planning notes from 2026-08-19, written before any of it is built so the
reasoning survives the gap between deciding and doing. Companion to
[learnings.md](learnings.md), which records what was learned building the tool
itself, and [CLAUDE.md](CLAUDE.md), which is the operational runbook.

Nothing here is implemented yet. The app is still a static site on GitHub Pages.

---

## 1. Two decisions that shape everything else

Neither is about authentication, which is the thing that feels like the hard
part and is not.

### The data licence stops being a grey area the moment money changes hands

Cboe's delayed-quotes page prohibits exactly what the app does, verbatim:

> IT IS STRICTLY PROHIBITED TO DOWNLOAD DELAYED QUOTE TABLE DATA FROM THIS WEB
> SITE BY USING AUTO-EXTRACTION PROGRAMS/QUERIES AND/OR SOFTWARE. CBOE WILL
> BLOCK IP ADDRESSES OF ALL PARTIES WHO ATTEMPT TO DO SO.

Two specifics get sharper with paying subscribers:

* a worker funnels every user through one set of IPs, so a block takes the
  product down for **everyone at once**, not gradually
* redistributing LiveVol data inside a paid product is a different legal
  question from one person looking at it

**A licensed feed must be in place before the first payment.** The vendor
subscription is the cheap part and the OPRA licence is the expensive part — see
§2, which is where the research landed and where the model decision actually
gets made.

Architecturally the switch is cheap, and deliberately so: all network access is
isolated in `src/api/marketData.js` and everything crosses the network through
the worker, so a migration touches the worker's upstream and one normaliser.
Commercially it is the line item that decides whether this is a business.

### A paywall in the user interface is not a paywall

Today **all of the value ships in the browser bundle** — `optionAnalytics`,
`optionComparison`, `gammaExposure`, `volatilitySurface`. Gating a chart behind
`if (user.isPro)` is bypassed with DevTools in about ten seconds.

The gate has to sit at the **data layer**: the worker refuses to return a chain
without a valid session. That is the single biggest structural consequence of
charging money, and it is why the API and the app belong in one deployable
rather than two.

The pure modules help here. They were written with no React and no network
precisely so they could be tested in node, and the same property means they run
**inside a Worker unchanged** whenever computation should move server-side to
keep it out of the bundle.

## 2. Market data: the licence costs more than the data

Researched 2026-08-19. **The subscription fee to a vendor is the small number.**
US options data is governed by OPRA, the Options Price Reporting Authority, and
its fees are charged separately from whatever a vendor charges for access.

### The rule that breaks the obvious plan

> "Even if you're licensed with us as a customer, that only covers your access to
> use the data internally — not the right to show it to others."

**Buying an API subscription does not give the right to show that data to paying
customers.** Both vendors consulted say the same thing: external display makes
you a redistributor, and a redistributor needs its own agreement with OPRA.
Theta Data puts it as "redistribution of any data from Theta Data is prohibited
unless there is a commercial agreement between your firm and Theta Data that
permits it".

This is the single most expensive assumption to get wrong, because it is
invisible until an audit.

### What the tiers cost

| Item | Real-time | 15-minute delayed |
| --- | --- | --- |
| Redistributor licence | $1,500/mo ($650 query-only) | **disputed — see below** |
| Per user, non-professional | $1.25/mo | none |
| Per user, professional | $31.50/mo | none |
| Non-display, per category | $2,000/mo | none |

**Non-display Category 2 is "calculations performed for customers (Greeks,
implied volatility)".** That is a literal description of this application. On
real-time data it would cost $2,000/month on its own, before any per-user fee
and before the vendor's own bill. Delayed data avoids it entirely.

Running real-time therefore starts around **$3,500/month in licence fees alone**.
That is not a small-business number pre-revenue.

### The contradiction worth resolving before committing

The two sources disagree on whether the redistributor fee applies to delayed
data, and the difference is $1,500 a month:

* **marketdata.app:** delayed avoids per-user and non-display fees, but "the
  redistributor fee is mandatory for any external-facing tool", delayed included
* **Theta Data:** "There are currently no OPRA fees for using or redistributing
  data that is over 15 minutes delayed" — while also noting you "may need to
  still register as a data vendor with OPRA if you are redistributing delayed
  data"

**Confirm this with OPRA directly before building a pricing model on it.** Two
vendors with commercial incentives are not a substitute for the plan
administrator, and the answer moves the break-even by $18,000 a year.

### The exemption that suggests the actual starting point

marketdata.app states that data at least one full trading day old is exempt from
OPRA licensing entirely — "Friday's data can only be used on Monday at 9:30 AM".
Theta Data does not address historical data, so this is one-sourced and needs
confirming too.

If it holds, it matters a great deal here, because **most of what this app
already computes does not need live data**:

* open interest is published end-of-day regardless, so the whole exposure page
  is inherently a T+1 view and already says so
* IV rank, skew comparison, term structure and max pain are positional
  measures, not tick measures
* the simulator prices a scenario, not a fill

A T+1 product would carry **no OPRA licensing at all** and lose very little of
the current feature set.

### Three viable models

| Model | Licence cost | What it supports |
| --- | --- | --- |
| **T+1, prior session close** | plausibly zero | Everything built so far, minus live premiums |
| **15-minute delayed** | $0–1,500/mo, unresolved | Same, with same-day context |
| **Real-time** | $3,500/mo and up | Intraday flow, live gamma — a different product |

Start at T+1, move to delayed when revenue justifies the fixed cost, and treat
real-time as a separate product decision rather than an upgrade.

### Vendors

Indicative 2026 pricing, gathered from vendor and comparison pages rather than
from quotes:

| Vendor | From | Notes |
| --- | --- | --- |
| **ORATS** | $99/mo | Options specialist. **Historical IV surface** — solves the gap in learnings.md §9, where per-ticker IV rank was impossible on the free Cboe feed. Hosted backtesting, proprietary indicators |
| **Theta Data** | usage-based | Cheaper per gigabyte, raw data, expects you to compute. Good fit given the analytics are already written |
| **FlashAlpha** | $29/mo | Cheapest delayed entry: 15-minute delay, 2 years history. $79 and $199 tiers add second aggregates and tick history |
| **Polygon** | ~$79/mo | Full chains, websockets, real-time consolidated quotes |
| **marketdata.app** | subscription, free trial | Clear REST design; publishes the clearest OPRA explainer of any vendor |
| Tradier, Intrinio, Unusual Whales | — | Also in the comparison set, not evaluated in depth |

**ORATS is the strongest fit** for a product that sells derived insight rather
than quotes, specifically because it supplies historical implied volatility.
That single feature closes the one analytical gap the current app cannot fill,
and it is the difference between "realized volatility rank, labelled honestly"
and actual IV rank.

**Theta Data is the value option** if cost matters more than convenience, since
the computation is already written and tested.

### What could not be verified

* whether individual vendors permit their customers to display data to end
  users, and on what terms — every vendor's own contract has to be read
* whether the historical exemption is as clean as one source suggests
* whether the delayed redistributor fee applies

All three are questions for OPRA and for a vendor's compliance team, not for a
search engine. None of them block building; all of them block charging.

## 3. Hosting: Workers with static assets, not Pages

This was checked rather than assumed, and the first instinct was wrong. Pages
looked like the obvious answer; Cloudflare's own guidance as of 2026 is the
opposite.

Since March 2026 Workers has feature parity with Pages for static assets, SSR
and custom domains, and **a single Worker can serve the frontend and the backend
together**. Cloudflare recommends Workers for new projects. Pages remains
supported, so there is no urgency for anyone already on it — but there is no
reason to start there.

Why it suits this project specifically:

* a Worker is already running, so it is not a new dependency
* frontend and API on **one origin** means session cookies work with no CORS
  negotiation — the problem that created the proxy in the first place
* the primitives needed later (D1, R2, KV, Durable Objects, Cron) are all Worker
  bindings

### Environments

Connect the repository and every push produces a preview deployment with its own
URL; merging to the production branch updates the live site. Preview URLs can be
put behind Cloudflare Access so staging is not public.

| Branch | Environment | URL |
| --- | --- | --- |
| `main` | production | `app.<domain>` |
| `staging` | staging | `staging.<domain>` |
| any branch or PR | preview | generated per deployment, Access-protected |

This answers the original question directly: yes, two versions, both browsable,
both updated by pushing.

**Buy the domain early.** It is the cheapest unblocker on the list — roughly $10
a year — and authentication emails, cookies and Stripe callbacks all want a real
domain. It can point at GitHub Pages until the cutover.

## 4. Repository shape

```
optionsimulator/
├── src/                    # React app, unchanged
├── worker/
│   ├── index.js            # /api/* to handlers, everything else to static assets
│   ├── auth.js             # sessions
│   ├── billing.js          # Stripe checkout and webhook
│   └── market.js           # today's proxy, now behind a session check
├── packages/core/          # optionAnalytics, gammaExposure, volatilitySurface, ...
│                           # pure; imported by BOTH the app and the worker
├── migrations/             # D1 schema
└── wrangler.toml           # env.staging / env.production
```

Moving the analytics to `packages/core` is the change that pays off later: it is
what allows server-side computation for paid tiers without rewriting anything.

## 5. The stack

| Need | Choice | Why |
| --- | --- | --- |
| Hosting and API | **Workers static assets** | One deploy, one origin, preview URL per branch |
| Database | **D1** | SQLite at the edge, native binding, generous free tier |
| Auth | **Better Auth** | First-class D1 support, self-hosted, no per-user cost. Email/password, social, magic links, 2FA, passkeys |
| Profile images | **R2** | S3-compatible, no egress charges |
| Sessions | **KV** | Short-lived, 7-day TTL |
| Billing | **Stripe** | Checkout plus webhook writing subscription state to D1 |

**The alternative worth knowing:** Clerk instead of Better Auth. Faster to ship
and works anywhere since it is only HTTP, but priced per monthly active user.
Self-hosting costs a weekend once; Clerk costs a little forever. Pre-revenue and
technical argues for self-hosting.

**Workers gotcha to remember:** re-instantiate the auth object per request from a
factory, never as a module-level singleton. Workers are stateless per request and
the D1 binding changes per invocation.

## 6. User management

Do not build this first. Most of it comes free:

* **Stripe dashboard** — subscriptions, churn, failed payments, refunds
* **D1 console / `wrangler d1 execute`** — direct queries against users

Then a thin `/admin` route gated to a single user id, reading from D1. Perhaps
two hundred lines. Build it when SQL becomes tedious, which needs a number of
users that does not exist yet.

## 7. Order of work

1. **Buy the domain** — unblocks everything downstream
2. **Restructure and move to Workers static assets** — `main` and `staging` both
   deploying and browsable, no auth yet. Deployment plumbing only, no behaviour
   change, GitHub Pages left running as a fallback
3. **D1 and Better Auth** — signup, login, profile, avatar upload to R2. This is
   where the home page and the account pages get built
4. **Move market data behind the session check** — the actual paywall
5. **Stripe** — plans, checkout, webhook to `subscription_status` in D1
6. **Admin route**
7. **Licensed data feed** — before the first real payment. Resolve the OPRA
   questions in §2 *before* setting prices, not after: whether the redistributor
   fee applies to delayed data moves the fixed cost by $18,000 a year, which is
   the difference between a viable and an unviable subscription price

Steps 2 and 3 deliver the staging environment and the account system that
prompted this document.

## 8. Still open

* **No domain yet.** Not needed for step 2; needed from step 3.
* **What is free and what is paid** is undecided. It determines whether the
  paywall gates whole pages or individual measures, which changes how much has
  to move server-side.
* **Whether to keep GitHub Pages** after the cutover, as a fallback or a
  marketing page.
* **The licensed feed is not chosen.** ORATS leads on capability because it
  carries historical implied volatility; Theta Data leads on cost. The choice
  should follow the decision above about which features are paid.
* **Three OPRA questions are unresolved** and all of them gate pricing rather
  than building: does the redistributor fee apply to delayed data, is
  day-old data genuinely exempt, and what does each vendor's own contract permit.
  Answers come from OPRA and vendor compliance, not from searching.

---

Sources for the hosting and auth conclusions:
[Cloudflare — migrate Pages to Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/),
[Cloudflare — Static Assets](https://developers.cloudflare.com/workers/static-assets/),
[Pages vs Workers in 2026](https://mecanik.dev/en/posts/cloudflare-pages-vs-workers-which-to-use-in-2026/),
[Better Auth with Cloudflare D1](https://dev.to/atman33/setup-better-auth-with-react-router-cloudflare-d1-2ad4),
[Workers + Hono + D1 + R2](https://www.buildmvpfast.com/blog/cloudflare-workers-hono-d1-r2-free-fullstack-2026)
