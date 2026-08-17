/**
 * Analytics derived from a normalized option chain (see src/api/marketData.js)
 * and a daily price history.
 *
 * Everything here is pure — chain in, numbers out — so it can be exercised in
 * node against a real Cboe payload without a browser or a network.
 *
 * Conventions, kept consistent throughout:
 *   - implied volatility is stored as a fraction (0.66) and displayed as % (66)
 *   - option-implied horizons scale with CALENDAR days over 365, which is what
 *     option pricing uses; realized volatility annualizes daily returns over 252
 *     trading days, which is what the sample actually contains
 */

const TRADING_DAYS = 252;
const CALENDAR_DAYS = 365;

/** Confidence levels offered for the forecast cone. */
export const CONFIDENCE_LEVELS = [
  { id: '68', label: '68%', z: 1, note: '±1 standard deviation' },
  { id: '90', label: '90%', z: 1.645, note: '±1.64 standard deviations' },
  { id: '95', label: '95%', z: 1.96, note: '±1.96 standard deviations' },
];

/* ------------------------------------------------------------------ *
 * Small shared helpers
 * ------------------------------------------------------------------ */

function allContracts(chain) {
  return chain?.bySymbol ? [...chain.bySymbol.values()] : [];
}

function startOfToday(today = new Date()) {
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * "YYYY-MM-DD" from local date parts. Not toISOString(), which converts to UTC
 * and so labels a date a day early for anyone west of Greenwich — the same
 * timezone bug that already bit the expiration labels once.
 */
function toLocalISODate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Calendar days from today to an ISO expiration, floored at 0. */
export function daysToExpiration(expiration, today = new Date()) {
  const [y, m, d] = String(expiration).split('-').map(Number);
  const exp = new Date(y, m - 1, d);
  return Math.max(0, Math.round((exp - startOfToday(today)) / 86400000));
}

/**
 * Linear interpolation of `value` at position `x` over points sorted by `x`.
 * Returns the nearest endpoint when x falls outside the range, rather than
 * extrapolating a volatility that nobody quoted.
 */
function interpolate(points, x) {
  if (!points.length) return null;
  if (points.length === 1) return points[0].value;
  if (x <= points[0].x) return points[0].value;
  if (x >= points[points.length - 1].x) return points[points.length - 1].value;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (x <= b.x) {
      const span = b.x - a.x;
      if (span === 0) return b.value;
      return a.value + ((x - a.x) * (b.value - a.value)) / span;
    }
  }
  return points[points.length - 1].value;
}

/* ------------------------------------------------------------------ *
 * Slicing the chain
 * ------------------------------------------------------------------ */

/**
 * Every expiration in the chain with enough context to choose one, nearest
 * first. `openInterest` is what makes an expiration worth looking at — a
 * listed-but-untraded expiry produces empty charts.
 */
export function listExpirations(chain, today = new Date()) {
  const buckets = new Map();

  for (const c of allContracts(chain)) {
    const bucket = buckets.get(c.expiration) || {
      expiration: c.expiration,
      contracts: 0,
      openInterest: 0,
      volume: 0,
    };
    bucket.contracts += 1;
    bucket.openInterest += Number(c.openInterest) || 0;
    bucket.volume += Number(c.volume) || 0;
    buckets.set(c.expiration, bucket);
  }

  return [...buckets.values()]
    .map((b) => ({ ...b, dte: daysToExpiration(b.expiration, today) }))
    .sort((a, b) => a.expiration.localeCompare(b.expiration));
}

/**
 * Calls and puts for one expiration, each sorted by strike and **one contract
 * per strike**.
 *
 * The deduplication is not cosmetic. Index chains list two series on the same
 * date — on the third Friday, SPX settles in the morning and SPXW in the
 * afternoon — which for SPX means 499 strikes carrying two contracts each.
 * Left alone, a strike-keyed map would silently keep whichever came last, and
 * summing open interest would add two different products together.
 *
 * Where a strike collides, the contract with more open interest wins: these are
 * genuinely different products, and the liquid one is the one worth charting.
 */
export function contractsFor(chain, expiration) {
  const pick = { call: new Map(), put: new Map() };

  for (const c of allContracts(chain)) {
    if (c.expiration !== expiration) continue;
    const side = pick[c.optionType];
    if (!side) continue;
    const held = side.get(c.strike);
    if (!held || (Number(c.openInterest) || 0) > (Number(held.openInterest) || 0)) {
      side.set(c.strike, c);
    }
  }

  const sorted = (map) => [...map.values()].sort((a, b) => a.strike - b.strike);
  return { calls: sorted(pick.call), puts: sorted(pick.put) };
}

/* ------------------------------------------------------------------ *
 * Implied volatility
 * ------------------------------------------------------------------ */

/**
 * At-the-money implied volatility, interpolated at spot.
 *
 * Call and put IV are averaged where both are quoted: in principle put-call
 * parity makes them equal, in practice they differ by a few tenths of a vol
 * point and averaging is steadier than picking a side.
 *
 * Returns a fraction (0.66), or null when the expiration has no usable quotes.
 */
export function atmIV(chain, expiration, spot) {
  if (!(spot > 0)) return null;
  const { calls, puts } = contractsFor(chain, expiration);

  const byStrike = new Map();
  for (const c of [...calls, ...puts]) {
    if (!(c.implied_volatility > 0)) continue;
    const entry = byStrike.get(c.strike) || { strike: c.strike, ivs: [] };
    entry.ivs.push(c.implied_volatility);
    byStrike.set(c.strike, entry);
  }

  const points = [...byStrike.values()]
    .map((e) => ({ x: e.strike, value: e.ivs.reduce((s, v) => s + v, 0) / e.ivs.length }))
    .sort((a, b) => a.x - b.x);

  return points.length ? interpolate(points, spot) : null;
}

/**
 * The volatility smile for one expiration: IV by strike.
 *
 * `otmIV` is the out-of-the-money composite — puts below spot, calls above —
 * which is the curve traders actually read, because OTM options carry the
 * liquidity and ITM quotes are mostly intrinsic value.
 */
export function smile(chain, expiration, spot) {
  const { calls, puts } = contractsFor(chain, expiration);
  const callByStrike = new Map(calls.map((c) => [c.strike, c]));
  const putByStrike = new Map(puts.map((c) => [c.strike, c]));
  const strikes = [...new Set([...callByStrike.keys(), ...putByStrike.keys()])].sort((a, b) => a - b);

  return strikes
    .map((strike) => {
      const call = callByStrike.get(strike);
      const put = putByStrike.get(strike);
      const callIV = call?.implied_volatility > 0 ? call.implied_volatility * 100 : null;
      const putIV = put?.implied_volatility > 0 ? put.implied_volatility * 100 : null;
      return {
        strike,
        callIV,
        putIV,
        otmIV: strike < spot ? putIV : callIV,
        moneyness: spot > 0 ? strike / spot : null,
        callOI: Number(call?.openInterest) || 0,
        putOI: Number(put?.openInterest) || 0,
      };
    })
    .filter((row) => row.callIV !== null || row.putIV !== null);
}

/**
 * ATM IV per expiration — the term structure.
 *
 * Upward sloping (contango) is the normal state: more time, more that can go
 * wrong. Downward sloping (backwardation) means the market is pricing a nearby
 * event as riskier than the long run, which is the shape that carries news.
 */
export function termStructure(chain, spot, today = new Date()) {
  return listExpirations(chain, today)
    .map((e) => ({ expiration: e.expiration, dte: e.dte, atmIV: atmIV(chain, e.expiration, spot) }))
    .filter((e) => e.atmIV !== null && e.dte > 0)
    .map((e) => ({ ...e, atmIVPct: e.atmIV * 100 }));
}

/**
 * 25-delta risk reversal: the IV a 25-delta put costs over a 25-delta call.
 *
 * Positive means downside protection is dearer than upside participation,
 * which is the normal state for equities. It is quoted at 25 delta rather than
 * at fixed strikes so it stays comparable across expirations and across names.
 */
export function riskReversal25(chain, expiration) {
  const { calls, puts } = contractsFor(chain, expiration);

  const nearest = (list, target) => {
    let best = null;
    let bestGap = Infinity;
    for (const c of list) {
      if (!(c.implied_volatility > 0) || c.delta === null || c.delta === undefined) continue;
      const gap = Math.abs(Math.abs(c.delta) - target);
      if (gap < bestGap) {
        bestGap = gap;
        best = c;
      }
    }
    // A chain with no delta anywhere near 25 would give a meaningless number.
    return bestGap <= 0.12 ? best : null;
  };

  const put = nearest(puts, 0.25);
  const call = nearest(calls, 0.25);
  if (!put || !call) return null;

  return {
    putIV: put.implied_volatility * 100,
    callIV: call.implied_volatility * 100,
    skew: (put.implied_volatility - call.implied_volatility) * 100,
    putStrike: put.strike,
    callStrike: call.strike,
    putDelta: put.delta,
    callDelta: call.delta,
  };
}

/* ------------------------------------------------------------------ *
 * Positioning
 * ------------------------------------------------------------------ */

/** Open interest and volume per strike, calls against puts. */
export function openInterestByStrike(chain, expiration) {
  const { calls, puts } = contractsFor(chain, expiration);
  const rows = new Map();

  const add = (c, side) => {
    const row = rows.get(c.strike) || {
      strike: c.strike, callOI: 0, putOI: 0, callVolume: 0, putVolume: 0,
    };
    row[`${side}OI`] += Number(c.openInterest) || 0;
    row[`${side}Volume`] += Number(c.volume) || 0;
    rows.set(c.strike, row);
  };

  calls.forEach((c) => add(c, 'call'));
  puts.forEach((c) => add(c, 'put'));

  return [...rows.values()]
    .map((r) => ({ ...r, totalOI: r.callOI + r.putOI, totalVolume: r.callVolume + r.putVolume }))
    .sort((a, b) => a.strike - b.strike);
}

/**
 * Put/call ratios. Open interest reflects accumulated positioning; volume
 * reflects what traded today, so the two answer different questions and both
 * are reported.
 */
export function putCallRatio(chain, expiration) {
  const { calls, puts } = contractsFor(chain, expiration);
  const sum = (list, field) => list.reduce((s, c) => s + (Number(c[field]) || 0), 0);

  const callOI = sum(calls, 'openInterest');
  const putOI = sum(puts, 'openInterest');
  const callVolume = sum(calls, 'volume');
  const putVolume = sum(puts, 'volume');

  return {
    callOI,
    putOI,
    callVolume,
    putVolume,
    oiRatio: callOI > 0 ? putOI / callOI : null,
    volumeRatio: callVolume > 0 ? putVolume / callVolume : null,
  };
}

/**
 * Max pain: the strike at which option holders collectively receive least, and
 * therefore writers pay least, if the stock settled exactly there.
 *
 * Read it as a map of where open interest sits, not as a forecast. The claim
 * that price is drawn toward it is weak and mostly a last-days-before-expiry
 * pinning effect; the curve is more informative than the single minimum.
 */
export function maxPain(chain, expiration) {
  const { calls, puts } = contractsFor(chain, expiration);
  const withOI = [...calls, ...puts].filter((c) => Number(c.openInterest) > 0);
  if (!withOI.length) return null;

  const strikes = [...new Set(withOI.map((c) => c.strike))].sort((a, b) => a - b);

  const curve = strikes.map((settle) => {
    let callPayout = 0;
    let putPayout = 0;
    for (const c of calls) {
      const oi = Number(c.openInterest) || 0;
      if (oi > 0 && settle > c.strike) callPayout += oi * (settle - c.strike) * 100;
    }
    for (const p of puts) {
      const oi = Number(p.openInterest) || 0;
      if (oi > 0 && settle < p.strike) putPayout += oi * (p.strike - settle) * 100;
    }
    return { strike: settle, callPayout, putPayout, payout: callPayout + putPayout };
  });

  const min = curve.reduce((best, row) => (row.payout < best.payout ? row : best), curve[0]);

  return {
    strike: min.strike,
    payoutAtMin: min.payout,
    curve,
    totalOI: withOI.reduce((s, c) => s + (Number(c.openInterest) || 0), 0),
  };
}

/* ------------------------------------------------------------------ *
 * Realized volatility and the forecast cone
 * ------------------------------------------------------------------ */

/**
 * Annualized realized volatility from daily closes, as a percentage.
 * `window` is in trading days — 30 is the usual comparison against IV30.
 */
export function realizedVol(history, window = 30) {
  if (!Array.isArray(history) || history.length < window + 2) return null;

  const closes = history.slice(-(window + 1)).map((d) => Number(d.close)).filter((c) => c > 0);
  if (closes.length < 3) return null;

  const returns = [];
  for (let i = 1; i < closes.length; i += 1) returns.push(Math.log(closes[i] / closes[i - 1]));

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  // Sample variance (n-1): these returns are a sample, not the population.
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);

  return Math.sqrt(variance * TRADING_DAYS) * 100;
}

/**
 * The 1-standard-deviation move implied for a horizon: spot × IV × √(days/365).
 * This is the number quoted as "the options market is pricing a ±X% move".
 */
export function expectedMove(spot, ivPct, dte) {
  if (!(spot > 0) || !(ivPct > 0) || !(dte > 0)) return null;
  const sigma = (ivPct / 100) * Math.sqrt(dte / CALENDAR_DAYS);
  return {
    sigma,
    pct: sigma * 100,
    abs: spot * sigma,
    upper: spot * Math.exp(sigma),
    lower: spot * Math.exp(-sigma),
  };
}

/**
 * A forward price interval implied by volatility, widening as √time.
 *
 * Prices are modelled as lognormal with no drift, so the band is
 * S₀·exp(±z·σ·√t) and the centre stays at today's price. Two consequences worth
 * being explicit about, because both are easy to misread:
 *
 *   - it is a *range*, not a forecast. The centre line is not a prediction that
 *     the price stays flat; it is the median of a distribution that widens
 *     symmetrically in log space (so the upper band is further away in dollars
 *     than the lower one)
 *   - it assumes volatility stays at today's level for the whole horizon
 */
export function forecastCone(spot, ivPct, dte, z = 1, { startDate = new Date(), steps = 40 } = {}) {
  if (!(spot > 0) || !(ivPct > 0) || !(dte > 0)) return [];

  const iv = ivPct / 100;
  const start = startOfToday(startDate);
  const points = [];
  const stepDays = Math.max(1, dte / steps);

  for (let day = 0; day <= dte + 0.0001; day += stepDays) {
    const t = Math.min(day, dte);
    const sigma = iv * Math.sqrt(t / CALENDAR_DAYS);
    const date = new Date(start);
    date.setDate(date.getDate() + Math.round(t));
    points.push({
      date: toLocalISODate(date),
      t,
      mid: spot,
      upper: spot * Math.exp(z * sigma),
      lower: spot * Math.exp(-z * sigma),
    });
  }
  return points;
}

/* ------------------------------------------------------------------ *
 * Plain-English readouts
 * ------------------------------------------------------------------ */

/**
 * Whether options look rich or cheap, by comparing implied to realized.
 * The gap is the volatility risk premium: positive is the normal state, since
 * option sellers charge for bearing the risk.
 */
export function volatilityVerdict(ivPct, rvPct) {
  if (!(ivPct > 0) || !(rvPct > 0)) return null;
  const spread = ivPct - rvPct;
  const ratio = ivPct / rvPct;

  let tone = 'neutral';
  let headline = 'Options are priced close to how the stock has actually moved.';
  if (ratio >= 1.25) {
    tone = 'rich';
    headline = 'Options look expensive versus how the stock has actually moved.';
  } else if (ratio <= 0.85) {
    tone = 'cheap';
    headline = 'Options look cheap versus how the stock has actually moved.';
  }

  return { spread, ratio, tone, headline };
}

/** Whether the term structure slopes up (calm now) or down (event risk now). */
export function termVerdict(term) {
  if (!term || term.length < 2) return null;
  const front = term[0];
  const back = term[term.length - 1];
  const slope = back.atmIVPct - front.atmIVPct;

  if (slope > 2) {
    return { shape: 'contango', slope, headline: 'Longer-dated options price more risk than near-dated ones — the usual, calm shape.' };
  }
  if (slope < -2) {
    return { shape: 'backwardation', slope, headline: 'Near-dated options price more risk than longer-dated ones — the market expects something soon.' };
  }
  return { shape: 'flat', slope, headline: 'Risk is priced evenly across expirations.' };
}

/** Which way the skew leans, in words. */
export function skewVerdict(rr) {
  if (!rr) return null;
  if (rr.skew > 1) {
    return { tone: 'downside', headline: `Puts cost ${rr.skew.toFixed(1)} vol points more than calls — the market is paying up for downside protection.` };
  }
  if (rr.skew < -1) {
    return { tone: 'upside', headline: `Calls cost ${Math.abs(rr.skew).toFixed(1)} vol points more than puts — demand is skewed toward upside.` };
  }
  return { tone: 'balanced', headline: 'Puts and calls are priced at about the same volatility.' };
}
