/**
 * Live market data for the options simulator.
 *
 * Source: Cboe's public delayed-quotes CDN (cdn.cboe.com). It is free, needs no
 * account and no API key, and returns the full option chain for a symbol
 * (bid / ask / last trade / IV / greeks / open interest) together with the
 * underlying stock quote. Because there is no key, nothing secret can ever end
 * up in the bundle shipped to the browser.
 *
 * The one catch: Cboe answers `Access-Control-Allow-Origin: https://www.cboe.com`,
 * so a browser will not let a page on another origin read the response. Every
 * request therefore goes through a *gateway* — a keyless pass-through that adds
 * CORS headers. Gateways are tried in order and the first one that works is
 * remembered for the rest of the session:
 *
 *   1. dev server   — Vite proxies /cboe/* to cdn.cboe.com (see vite.config.js).
 *   2. VITE_MARKET_PROXY — your own pass-through, e.g. a free Cloudflare Worker.
 *                          See proxy/cloudflare-worker.js in this repo.
 *   3. public CORS proxies — zero setup, but rate-limited and occasionally down.
 *      They are a fallback, not something to rely on in production.
 */

const CBOE_ORIGIN = 'https://cdn.cboe.com';

const CBOE_PATHS = {
  chain: (symbol) => `/api/global/delayed_quotes/options/${symbol}.json`,
  quote: (symbol) => `/api/global/delayed_quotes/quotes/${symbol}.json`,
  symbolBook: () => '/api/global/delayed_quotes/symbol_book/symbol-book.json',
  history: (symbol) => `/api/global/delayed_quotes/charts/historical/${symbol}.json`,
};

// Cboe prefixes cash indices with an underscore.
const INDEX_SYMBOLS = {
  SPX: '_SPX', NDX: '_NDX', RUT: '_RUT', VIX: '_VIX', DJX: '_DJX', XSP: '_XSP',
};

const CUSTOM_PROXY = (import.meta.env?.VITE_MARKET_PROXY || '').replace(/\/$/, '');

const GATEWAYS = [
  import.meta.env?.DEV && { name: 'vite-dev-proxy', url: (path) => `/cboe${path}` },
  CUSTOM_PROXY && { name: 'custom-proxy', url: (path) => `${CUSTOM_PROXY}${path}` },
  {
    name: 'allorigins',
    url: (path) => `https://api.allorigins.win/raw?url=${encodeURIComponent(CBOE_ORIGIN + path)}`,
  },
  {
    name: 'codetabs',
    url: (path) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(CBOE_ORIGIN + path)}`,
  },
].filter(Boolean);

let preferredGateway = null;

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a Cboe path through the first gateway that answers. */
async function fetchThroughGateway(path, { timeoutMs = 25000 } = {}) {
  const ordered = preferredGateway
    ? [preferredGateway, ...GATEWAYS.filter((g) => g !== preferredGateway)]
    : GATEWAYS;

  const failures = [];
  for (const gateway of ordered) {
    try {
      const data = await fetchJson(gateway.url(path), timeoutMs);
      preferredGateway = gateway;
      return data;
    } catch (err) {
      failures.push(`${gateway.name}: ${err.message}`);
      if (preferredGateway === gateway) preferredGateway = null;
    }
  }
  throw new Error(`No market-data gateway responded (${failures.join(' | ')})`);
}

/* ------------------------------------------------------------------ *
 * OCC symbol parsing
 * ------------------------------------------------------------------ */

// e.g. MSTR260821C00092000 -> MSTR, 2026-08-21, call, strike 92
const OCC_PATTERN = /^([A-Z0-9]+?)(\d{6})([CP])(\d{8})$/;

function parseOccSymbol(occ) {
  const match = OCC_PATTERN.exec(occ);
  if (!match) return null;
  const [, root, yymmdd, right, strikeRaw] = match;
  return {
    root,
    expiration: `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`,
    optionType: right === 'C' ? 'call' : 'put',
    strike: parseInt(strikeRaw, 10) / 1000,
  };
}

/**
 * A root that is the ticker plus a trailing digit (ASST1, ASST2) is an OCC
 * *adjusted* series: a corporate action changed what one contract delivers, so
 * it is no longer 100 ordinary shares. Roots that differ by a letter instead
 * (SPXW, NDXP) are ordinary separate series and must not be flagged.
 */
function isAdjustedRoot(root, symbol) {
  return root !== symbol && root.startsWith(symbol) && /\d$/.test(root);
}

/**
 * Everything an OCC symbol encodes, without needing the chain.
 *
 * This is what lets a shared link render its contract immediately: the symbol
 * alone carries strike, expiration and side, so the picker can show the right
 * label while the chain is still loading, or if it fails to load at all.
 */
export function describeOccSymbol(occ) {
  const parsed = parseOccSymbol(String(occ || '').toUpperCase());
  if (!parsed) return null;
  return {
    ...parsed,
    label: `${parsed.strike} - ${formatExpiration(parsed.expiration)}`,
  };
}

/** Parse "YYYY-MM-DD" in local time so the displayed day never shifts by timezone. */
export function parseISODate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatExpiration(iso) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const date = parseISODate(iso);
  return `${months[date.getMonth()]} ${date.getDate()}, '${String(date.getFullYear()).slice(-2)}`;
}

/** Strike as a stable key: 92 -> "92", 92.5 -> "92.5". */
function strikeKey(strike) {
  return String(Number(strike.toFixed(3)));
}

/**
 * Mid price when there is a two-sided market, otherwise the last trade.
 * The mid is what a retail platform shows as the "mark".
 */
function markPrice(quote) {
  const { bid, ask, last_trade_price: last, theo } = quote;
  if (bid > 0 && ask > 0) return Math.round(((bid + ask) / 2) * 100) / 100;
  if (last > 0) return last;
  return theo > 0 ? Math.round(theo * 100) / 100 : 0;
}

/* ------------------------------------------------------------------ *
 * Option chain
 * ------------------------------------------------------------------ */

const chainCache = new Map(); // symbol -> { fetchedAt, chain }
const CHAIN_TTL_MS = 5 * 60 * 1000;

export function normalizeSymbol(input) {
  return String(input || '').trim().toUpperCase();
}

function cboeSymbol(symbol) {
  return INDEX_SYMBOLS[symbol] || symbol;
}

/**
 * Shape the raw Cboe payload into what the simulator consumes:
 *   contracts[optionType][strike] = [{ expiration, mark, implied_volatility, ... }]
 * Expired contracts and strikes far away from spot are dropped — a full chain is
 * ~3,000 rows and most of it is untradeable noise.
 */
function normalizeChain(payload, symbol) {
  const data = payload?.data;
  if (!data) throw new Error('Unexpected response shape from market data source');

  const stockPrice = Number(data.current_price) || 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const minStrike = stockPrice > 0 ? stockPrice * 0.2 : 0;
  const maxStrike = stockPrice > 0 ? stockPrice * 5 : Infinity;

  const contracts = { call: {}, put: {} };
  // The OCC symbol is the only unique identity a contract has: strike and
  // expiration alone collide across adjusted series (ASST / ASST1 / ASST2 all
  // list a 15-strike Jan-2028 call at very different prices).
  const bySymbol = new Map();
  let kept = 0;
  // Counted, not just dropped: on a name like ASST the adjusted series are most
  // of the chain, and a page that silently screens a third of what the user can
  // see on their broker's screen owes them an explanation.
  let adjusted = 0;

  for (const quote of data.options || []) {
    const parsed = parseOccSymbol(quote.option);
    if (!parsed) continue;
    if (parsed.strike < minStrike || parsed.strike > maxStrike) continue;
    if (parseISODate(parsed.expiration) < today) continue;
    // Adjusted series are dropped rather than shown: one contract no longer
    // delivers 100 ordinary shares, so the simulator's payoff model does not
    // apply to them and every number it produces would be wrong.
    if (isAdjustedRoot(parsed.root, symbol)) { adjusted += 1; continue; }

    const contract = {
      expiration: parsed.expiration,
      mark: markPrice(quote),
      implied_volatility: quote.iv > 0 ? quote.iv : null,
      bid: quote.bid,
      ask: quote.ask,
      last: quote.last_trade_price,
      lastTradeTime: quote.last_trade_time,
      volume: quote.volume,
      openInterest: quote.open_interest,
      delta: quote.delta,
      // Kept so exposure models can cross-check their own Black-Scholes against
      // the exchange's published greeks at today's spot.
      gamma: quote.gamma,
      vega: quote.vega,
      theta: quote.theta,
      occSymbol: quote.option,
      optionType: parsed.optionType,
      strike: parsed.strike,
      root: parsed.root,
      // SPXW and NDXP survive the filter above and still share strikes and
      // expirations with the standard series, so the root must reach the UI.
      isStandardRoot: parsed.root === symbol,
    };

    const bucket = contracts[parsed.optionType];
    (bucket[strikeKey(parsed.strike)] ||= []).push(contract);
    bySymbol.set(contract.occSymbol, contract);
    kept += 1;
  }

  for (const side of Object.values(contracts)) {
    for (const list of Object.values(side)) {
      // Standard series first, so the ordinary contract is the obvious default.
      list.sort(
        (a, b) =>
          a.expiration.localeCompare(b.expiration) ||
          Number(b.isStandardRoot) - Number(a.isStandardRoot) ||
          a.root.localeCompare(b.root),
      );
    }
  }

  return {
    symbol,
    stockPrice,
    iv30: Number(data.iv30) || null,
    priceChangePercent: Number(data.price_change_percent) || 0,
    quoteTime: payload.timestamp || data.last_trade_time || null,
    contractCount: kept,
    adjustedCount: adjusted,
    contracts,
    bySymbol,
  };
}

/**
 * Fetch the live option chain plus the underlying price for a symbol.
 * Results are cached in memory for a few minutes — the feed is delayed anyway.
 */
export async function fetchOptionChain(rawSymbol, { force = false } = {}) {
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol) throw new Error('No ticker provided');

  const cached = chainCache.get(symbol);
  if (!force && cached && Date.now() - cached.fetchedAt < CHAIN_TTL_MS) return cached.chain;

  let payload;
  try {
    payload = await fetchThroughGateway(CBOE_PATHS.chain(cboeSymbol(symbol)), { timeoutMs: 30000 });
  } catch (err) {
    // Cboe answers 403 (not 404) for symbols it does not publish.
    if (/HTTP 40[34]/.test(err.message)) {
      throw new Error(`No listed options found for ${symbol}`);
    }
    throw err;
  }

  const chain = normalizeChain(payload, symbol);
  if (chain.contractCount === 0) throw new Error(`No tradeable contracts found for ${symbol}`);

  chainCache.set(symbol, { fetchedAt: Date.now(), chain });
  return chain;
}

/** Underlying quote only — much smaller than the chain, for a quick price refresh. */
export async function fetchQuote(rawSymbol) {
  const symbol = normalizeSymbol(rawSymbol);
  const payload = await fetchThroughGateway(CBOE_PATHS.quote(cboeSymbol(symbol)), { timeoutMs: 15000 });
  const data = payload?.data || {};
  return {
    symbol,
    stockPrice: Number(data.current_price) || 0,
    bid: data.bid,
    ask: data.ask,
    iv30: Number(data.iv30) || null,
    quoteTime: payload?.timestamp || null,
  };
}

/**
 * Look up one exact contract inside an already-fetched chain by its OCC symbol.
 * Returns null when that contract is no longer quoted.
 *
 * Keyed on the OCC symbol rather than strike + expiration on purpose: those two
 * do not identify a contract when adjusted series exist (see isAdjustedRoot).
 */
export function findContractByOcc(chain, occSymbol) {
  return chain?.bySymbol?.get(occSymbol) || null;
}

/* ------------------------------------------------------------------ *
 * Daily price history
 * ------------------------------------------------------------------ */

const historyCache = new Map(); // symbol -> { fetchedAt, history }
const HISTORY_TTL_MS = 30 * 60 * 1000; // daily bars; refetching often buys nothing

/**
 * Daily OHLCV for a symbol, oldest first. Cboe serves the full listed history
 * (MSTR goes back to 2004), which is far more than any chart needs, so callers
 * pass `days` to trim it. Realized volatility is computed from these closes.
 */
export async function fetchPriceHistory(rawSymbol, { days = null, force = false } = {}) {
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol) throw new Error('No ticker provided');

  const cached = historyCache.get(symbol);
  let history = !force && cached && Date.now() - cached.fetchedAt < HISTORY_TTL_MS
    ? cached.history
    : null;

  if (!history) {
    const payload = await fetchThroughGateway(CBOE_PATHS.history(cboeSymbol(symbol)), { timeoutMs: 30000 });
    history = (payload?.data || [])
      .map((bar) => ({
        date: bar.date,
        open: Number(bar.open) || 0,
        high: Number(bar.high) || 0,
        low: Number(bar.low) || 0,
        close: Number(bar.close) || 0,
        volume: Number(bar.volume) || 0,
      }))
      .filter((bar) => bar.date && bar.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (!history.length) throw new Error(`No price history available for ${symbol}`);
    historyCache.set(symbol, { fetchedAt: Date.now(), history });
  }

  return days && days < history.length ? history.slice(-days) : history;
}

/* ------------------------------------------------------------------ *
 * Ticker search
 * ------------------------------------------------------------------ */

let symbolBookPromise = null;

/** All symbols Cboe lists options on (~35k rows: ticker + company name). */
function loadSymbolBook() {
  symbolBookPromise ||= fetchThroughGateway(CBOE_PATHS.symbolBook(), { timeoutMs: 30000 })
    .then((payload) =>
      (payload?.data || []).map(({ name, company_name: company }) => ({
        symbol: name,
        name: company || '',
      })),
    )
    .catch((err) => {
      symbolBookPromise = null; // allow a retry on the next keystroke
      throw err;
    });
  return symbolBookPromise;
}

/**
 * Search listed symbols by ticker or company name.
 * Exact ticker first, then ticker prefix, then everything else.
 */
export async function searchSymbols(query, { limit = 25 } = {}) {
  const q = normalizeSymbol(query);
  if (!q) return [];

  const book = await loadSymbolBook();
  const lower = q.toLowerCase();
  const scored = [];

  for (const entry of book) {
    const symbol = entry.symbol.toUpperCase();
    let score;
    if (symbol === q) score = 0;
    else if (symbol.startsWith(q)) score = 1;
    else if (entry.name.toLowerCase().startsWith(lower)) score = 2;
    else if (entry.name.toLowerCase().includes(lower)) score = 3;
    else continue;

    scored.push({ ...entry, score });
    if (score === 0 && scored.length > limit * 4) break;
  }

  scored.sort((a, b) => a.score - b.score || a.symbol.length - b.symbol.length || a.symbol.localeCompare(b.symbol));
  return scored.slice(0, limit);
}
