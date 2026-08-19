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

**A licensed feed must be in place before the first payment.** Candidates:
marketdata.app, Polygon, ORATS, Tradier — roughly $50–300/month.

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

## 2. Hosting: Workers with static assets, not Pages

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

## 3. Repository shape

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

## 4. The stack

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

## 5. User management

Do not build this first. Most of it comes free:

* **Stripe dashboard** — subscriptions, churn, failed payments, refunds
* **D1 console / `wrangler d1 execute`** — direct queries against users

Then a thin `/admin` route gated to a single user id, reading from D1. Perhaps
two hundred lines. Build it when SQL becomes tedious, which needs a number of
users that does not exist yet.

## 6. Order of work

1. **Buy the domain** — unblocks everything downstream
2. **Restructure and move to Workers static assets** — `main` and `staging` both
   deploying and browsable, no auth yet. Deployment plumbing only, no behaviour
   change, GitHub Pages left running as a fallback
3. **D1 and Better Auth** — signup, login, profile, avatar upload to R2. This is
   where the home page and the account pages get built
4. **Move market data behind the session check** — the actual paywall
5. **Stripe** — plans, checkout, webhook to `subscription_status` in D1
6. **Admin route**
7. **Licensed data feed** — before the first real payment

Steps 2 and 3 deliver the staging environment and the account system that
prompted this document.

## 7. Still open

* **No domain yet.** Not needed for step 2; needed from step 3.
* **What is free and what is paid** is undecided. It determines whether the
  paywall gates whole pages or individual measures, which changes how much has
  to move server-side.
* **Whether to keep GitHub Pages** after the cutover, as a fallback or a
  marketing page.
* **The licensed feed is not chosen.** Pricing and coverage differ enough that
  the choice should follow the decision above about which features are paid.

---

Sources for the hosting and auth conclusions:
[Cloudflare — migrate Pages to Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/),
[Cloudflare — Static Assets](https://developers.cloudflare.com/workers/static-assets/),
[Pages vs Workers in 2026](https://mecanik.dev/en/posts/cloudflare-pages-vs-workers-which-to-use-in-2026/),
[Better Auth with Cloudflare D1](https://dev.to/atman33/setup-better-auth-with-react-router-cloudflare-d1-2ad4),
[Workers + Hono + D1 + R2](https://www.buildmvpfast.com/blog/cloudflare-workers-hono-d1-r2-free-fullstack-2026)
