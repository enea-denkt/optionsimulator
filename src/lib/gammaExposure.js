/**
 * Dealer gamma and vanna exposure.
 *
 * ## The idea
 *
 * Market makers who sell options hedge in the underlying, and how they hedge
 * depends on the sign of their gamma. Long gamma means selling into strength and
 * buying weakness, which damps moves and pins price near heavily-owned strikes.
 * Short gamma means the opposite: buying strength and selling weakness, which
 * amplifies whatever direction the market is already going.
 *
 * Aggregating each contract's gamma against its open interest gives a map of
 * where that hedging pressure sits, and the spot level where the sign flips.
 *
 * ## The assumption that everything rests on
 *
 * Open interest says how many contracts exist. It does **not** say who is long
 * and who is short. Every public gamma-exposure model closes that gap with a
 * convention, and the common one — from the original SqueezeMetrics work — is
 * that dealers are **long calls and short puts**, because customers on balance
 * buy puts for protection and sell calls for yield.
 *
 * That is an assumption, not an observation, and it is the single biggest
 * weakness in every GEX number published anywhere, including this one. When it
 * is wrong for a given name, the sign of the whole picture is wrong. It is
 * exposed as a setting rather than buried, so it can at least be argued with.
 *
 * ## Units
 *
 * Gamma exposure is reported as **dollars of delta the dealer must trade per 1%
 * move in spot**. Vanna exposure is **dollars of delta per 1 volatility point**.
 * Both are per-strike sums across contracts.
 */

const CONTRACT_MULTIPLIER = 100;
const CALENDAR_DAYS = 365;

/** Standard normal probability density. */
function phi(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Black-Scholes d1. Returns null when the inputs cannot support it — an expired
 * contract, a zero volatility, a nonsense strike.
 */
function d1Of(spot, strike, years, sigma, rate) {
  if (!(spot > 0) || !(strike > 0) || !(years > 0) || !(sigma > 0)) return null;
  return (Math.log(spot / strike) + (rate + (sigma * sigma) / 2) * years) / (sigma * Math.sqrt(years));
}

/**
 * Gamma and vanna from Black-Scholes, per share, for one contract.
 *
 * These are recomputed rather than taken from the feed because the whole point
 * of a gamma profile is asking what the exposure *would* be at a spot price
 * other than today's, and the feed only publishes greeks at today's.
 *
 * Both are identical for calls and puts, which is why no option type is needed.
 */
export function greeksAt(spot, strike, years, sigma, rate = 0.04) {
  const d1 = d1Of(spot, strike, years, sigma, rate);
  if (d1 === null) return { gamma: 0, vanna: 0 };

  const sqrtT = Math.sqrt(years);
  const d2 = d1 - sigma * sqrtT;
  const density = phi(d1);

  return {
    gamma: density / (spot * sigma * sqrtT),
    // dDelta/dSigma, per one whole unit of vol (1.00 = 100 points).
    vanna: (-density * d2) / sigma,
  };
}

/** Years to expiry, floored just above zero so same-day contracts stay finite. */
export function yearsToExpiry(dte) {
  return Math.max(dte, 0.5) / CALENDAR_DAYS;
}

/**
 * Sign of the dealer's position in a contract, under the chosen convention.
 * `assumption` is 'dealer-long-calls' (the standard) or 'dealer-short-all',
 * which flips puts to match calls and is worth trying when a name is dominated
 * by customers selling puts rather than buying them.
 */
function dealerSign(optionType, assumption) {
  if (assumption === 'dealer-short-all') return -1;
  return optionType === 'call' ? 1 : -1;
}

export const DEALER_ASSUMPTIONS = {
  'dealer-long-calls': {
    id: 'dealer-long-calls',
    label: 'Dealers long calls, short puts',
    blurb: 'The standard convention: customers buy puts for protection and sell calls for yield.',
  },
  'dealer-short-all': {
    id: 'dealer-short-all',
    label: 'Dealers short everything',
    blurb: 'Assumes customers are net buyers of both sides. Flips the sign of put exposure.',
  },
};

/**
 * Per-strike gamma and vanna exposure for one set of contracts, evaluated at a
 * given spot. Pass `atSpot` different from the live price to ask what the
 * exposure would become if price moved there.
 */
export function exposureByStrike(contracts, { atSpot, rate = 0.04, assumption = 'dealer-long-calls' } = {}) {
  const rows = new Map();

  for (const c of contracts) {
    const oi = Number(c.openInterest) || 0;
    if (oi <= 0) continue;

    const sigma = c.implied_volatility > 0 ? c.implied_volatility : null;
    if (!sigma) continue;

    const years = yearsToExpiry(c.dte);
    const { gamma, vanna } = greeksAt(atSpot, c.strike, years, sigma, rate);
    const sign = dealerSign(c.optionType, assumption);

    // Dollars of delta per 1% move in spot.
    const gex = sign * gamma * oi * CONTRACT_MULTIPLIER * atSpot * atSpot * 0.01;
    // Dollars of delta per 1 volatility point.
    const vex = sign * vanna * oi * CONTRACT_MULTIPLIER * atSpot * 0.01;

    const row = rows.get(c.strike) || {
      strike: c.strike, gex: 0, vex: 0, callGex: 0, putGex: 0, callOI: 0, putOI: 0, oi: 0,
    };
    row.gex += gex;
    row.vex += vex;
    row.oi += oi;
    if (c.optionType === 'call') {
      row.callGex += gex;
      row.callOI += oi;
    } else {
      row.putGex += gex;
      row.putOI += oi;
    }
    rows.set(c.strike, row);
  }

  return [...rows.values()].sort((a, b) => a.strike - b.strike);
}

/**
 * Net exposure across every strike, evaluated at a range of hypothetical spot
 * prices. The zero crossing of this curve is the gamma flip.
 *
 * Volatility is held at each contract's current implied level while spot is
 * swept. That is the usual simplification and it is worth naming: in reality
 * volatility rises as price falls, which tends to push the true flip level
 * higher than this curve suggests.
 */
export function exposureProfile(contracts, { spot, range = 0.2, steps = 61, rate = 0.04, assumption } = {}) {
  if (!(spot > 0)) return [];

  const out = [];
  for (let i = 0; i < steps; i += 1) {
    const price = spot * (1 - range + (2 * range * i) / (steps - 1));
    const rows = exposureByStrike(contracts, { atSpot: price, rate, assumption });
    out.push({
      price,
      gex: rows.reduce((s, r) => s + r.gex, 0),
      vex: rows.reduce((s, r) => s + r.vex, 0),
    });
  }
  return out;
}

/**
 * The spot price at which net gamma exposure crosses zero, interpolated between
 * the two profile points that straddle it.
 *
 * Returns null when the curve never changes sign in the swept range, which is a
 * real and common outcome — it means the regime does not flip anywhere nearby,
 * not that the calculation failed.
 */
export function gammaFlip(profile) {
  for (let i = 1; i < profile.length; i += 1) {
    const prev = profile[i - 1];
    const curr = profile[i];
    if ((prev.gex <= 0 && curr.gex > 0) || (prev.gex >= 0 && curr.gex < 0)) {
      const span = curr.gex - prev.gex;
      if (span === 0) return curr.price;
      const t = -prev.gex / span;
      return prev.price + t * (curr.price - prev.price);
    }
  }
  return null;
}

/**
 * The strikes that matter: the largest concentration of positive dealer gamma
 * above spot, and of negative gamma below it.
 *
 * In a positive-gamma regime these behave as magnets — hedging leans against
 * moves toward them. In a negative-gamma regime a break through one tends to
 * accelerate instead, because the hedging that was cushioning the move reverses.
 */
export function keyLevels(rows, spot) {
  const above = rows.filter((r) => r.strike >= spot);
  const below = rows.filter((r) => r.strike <= spot);

  const callWall = above.reduce((best, r) => (r.callGex > (best?.callGex ?? -Infinity) ? r : best), null);
  const putWall = below.reduce((best, r) => (r.putGex < (best?.putGex ?? Infinity) ? r : best), null);
  const largestOI = rows.reduce((best, r) => (r.oi > (best?.oi ?? -1) ? r : best), null);

  return {
    callWall: callWall && callWall.callGex > 0 ? callWall : null,
    putWall: putWall && putWall.putGex < 0 ? putWall : null,
    largestOI,
  };
}

/**
 * Exposure laid out as expiration by strike — the grid the heatmap draws.
 * Each cell is evaluated at today's spot, so the map shows where hedging
 * pressure sits right now rather than under a hypothetical move.
 */
export function exposureGrid(chain, expirations, { spot, metric = 'gex', rate = 0.04, assumption } = {}) {
  const cells = [];
  const strikes = new Set();

  for (const exp of expirations) {
    const contracts = [];
    for (const c of chain.bySymbol.values()) {
      if (c.expiration !== exp.expiration) continue;
      contracts.push({ ...c, dte: exp.dte });
    }

    for (const row of exposureByStrike(contracts, { atSpot: spot, rate, assumption })) {
      strikes.add(row.strike);
      cells.push({
        expiration: exp.expiration,
        dte: exp.dte,
        strike: row.strike,
        value: metric === 'vex' ? row.vex : metric === 'oi' ? row.oi : row.gex,
        gex: row.gex,
        vex: row.vex,
        oi: row.oi,
        callOI: row.callOI,
        putOI: row.putOI,
      });
    }
  }

  return { cells, strikes: [...strikes].sort((a, b) => a - b) };
}

/** Plain-English reading of the regime. */
export function regimeVerdict(netGex, spot, flip) {
  if (!Number.isFinite(netGex)) return null;

  const positive = netGex > 0;
  const distance = flip && spot > 0 ? ((flip - spot) / spot) * 100 : null;
  const where = flip
    ? ` The flip sits at $${flip.toFixed(2)}, ${Math.abs(distance).toFixed(1)}% ${distance > 0 ? 'above' : 'below'} spot.`
    : ' No flip level appears within 20% of spot, so the regime is unlikely to change on an ordinary move.';

  if (positive) {
    return {
      tone: 'positive',
      regime: 'Positive gamma',
      headline: `Dealers are net long gamma, so their hedging leans against moves — selling strength and buying weakness. That damps volatility and tends to pin price near heavily-owned strikes.${where}`,
    };
  }
  return {
    tone: 'caution',
    regime: 'Negative gamma',
    headline: `Dealers are net short gamma, so their hedging runs with the move — buying strength and selling weakness. That amplifies volatility and makes trends extend rather than mean-revert.${where}`,
  };
}

/** Compact dollar formatting for exposure magnitudes. */
export function formatExposure(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}
