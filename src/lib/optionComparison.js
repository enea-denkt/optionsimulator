/**
 * Comparing the same option across different underlyings.
 *
 * The problem this solves: a $9 premium on a $95 stock and a $4 premium on a
 * $300 stock are not comparable, and neither are two contracts picked at
 * whatever strikes happen to be listed. To line names up fairly, each one is
 * sampled at the *same* point on its own surface — the same moneyness, or the
 * same delta — and at a similar time to expiry. Everything is then expressed in
 * ratios rather than dollars.
 */

import { contractsFor, listExpirations, expectedMove } from './optionAnalytics.js';

/** How the strike is chosen on each name's chain. */
export const MATCH_MODES = {
  moneyness: {
    id: 'moneyness',
    label: 'Same moneyness',
    blurb: 'Strike at a fixed percentage of each share price',
  },
  delta: {
    id: 'delta',
    label: 'Same delta',
    blurb: 'Strike at a fixed delta, so each option is equally likely to finish in the money',
  },
};

/**
 * Delta is usually the better matcher of the two. Equal moneyness on a calm
 * name and a volatile one picks options with very different odds of paying out,
 * whereas equal delta picks options the market considers equally likely to
 * finish in the money — which is closer to what "the same trade" means.
 */
/**
 * How far the chosen strike may sit from the requested moneyness, in units of
 * spot. Ten points is loose enough for coarse ladders and tight enough that a
 * row never claims a moneyness it does not have.
 */
const MONEYNESS_TOLERANCE = 0.1;

export const DEFAULT_DELTA = 0.3;
export const DEFAULT_MONEYNESS = 1;
export const DEFAULT_TARGET_DTE = 30;

/** The expiration closest to the requested days-to-expiry. */
export function pickExpiration(chain, targetDte, today = new Date()) {
  const expirations = listExpirations(chain, today).filter((e) => e.dte > 0 && e.openInterest > 0);
  if (!expirations.length) return null;

  return expirations.reduce(
    (best, e) => (Math.abs(e.dte - targetDte) < Math.abs(best.dte - targetDte) ? e : best),
    expirations[0],
  );
}

/**
 * The contract on one expiration that best matches the requested moneyness or
 * delta. Contracts without a usable quote are skipped: a strike with no market
 * would otherwise win on "cheapest premium" while being untradeable.
 */
export function pickContract(chain, expiration, optionType, { mode, moneyness, delta, spot }) {
  const { calls, puts } = contractsFor(chain, expiration);
  const candidates = (optionType === 'put' ? puts : calls).filter(
    (c) => c.mark > 0 && (c.bid > 0 || c.last > 0),
  );
  if (!candidates.length) return null;

  if (mode === 'delta') {
    const target = Math.abs(delta);
    let best = null;
    let bestGap = Infinity;
    for (const c of candidates) {
      if (c.delta === null || c.delta === undefined) continue;
      const gap = Math.abs(Math.abs(c.delta) - target);
      if (gap < bestGap) {
        bestGap = gap;
        best = c;
      }
    }
    // Refuse a match that is nowhere near the requested delta rather than
    // silently comparing a 0.05-delta option against a 0.30-delta one.
    if (best && bestGap <= 0.15) return best;
    return null;
  }

  const targetStrike = spot * moneyness;
  const best = candidates.reduce(
    (winner, c) => (Math.abs(c.strike - targetStrike) < Math.abs(winner.strike - targetStrike) ? c : winner),
    candidates[0],
  );

  // Strike ladders stop well short of the extremes on many names — KO lists
  // nothing above 125, so asking for 200% of spot would otherwise return a 144%
  // contract labelled as if it were the thing requested. Refuse it, the same way
  // delta mode refuses a match nowhere near the requested delta.
  const achieved = spot > 0 ? best.strike / spot : null;
  return achieved !== null && Math.abs(achieved - moneyness) <= MONEYNESS_TOLERANCE ? best : null;
}

/**
 * Everything needed to rank one name against another.
 *
 * On what "expensive" means — three different answers are reported because
 * they genuinely disagree:
 *
 *   - **Implied volatility** is the price of volatility itself, already
 *     normalised for share price and time. It is the cleanest cross-name
 *     comparison, and the one an options trader means by "expensive".
 *   - **Premium as a share of spot** is the cash cost of the exposure. A name
 *     can carry high IV and still be cheap in dollars if it is short-dated.
 *   - **Breakeven move against implied move** is the one a directional buyer
 *     actually feels: how far the stock must travel to profit, measured against
 *     how far the market already expects it to travel. Below 1 means the
 *     breakeven sits inside the expected range.
 */
export function compareContract({ symbol, chain, expiration, dte, contract, optionType }) {
  const spot = chain.stockPrice;
  const premium = contract.mark;
  const ivPct = contract.implied_volatility > 0 ? contract.implied_volatility * 100 : null;

  // Where the stock must be at expiry to return the premium.
  const breakeven = optionType === 'put'
    ? contract.strike - premium
    : contract.strike + premium;
  const breakevenMovePct = spot > 0 ? ((breakeven - spot) / spot) * 100 : null;

  const move = ivPct ? expectedMove(spot, ivPct, dte) : null;
  const impliedMovePct = move ? move.pct : null;

  // Where the option's return on capital equals the return on simply owning the
  // shares. Setting (S-K-P)/P = (S-S0)/S0 for a call and solving gives
  // S* = S0*K / (S0 - P); the put case flips the sign to S0*K / (S0 + P).
  //
  // Breakeven only asks the option not to lose money; this asks it to beat the
  // alternative of putting the same conviction into shares. Which of the two is
  // the harder test depends on the side, and it is worth being exact:
  //
  //   - for a **call** the benchmark is gaining as the stock rises, so the
  //     option has to clear breakeven and then keep going
  //   - for a **put** the benchmark is losing as the stock falls, so the put can
  //     beat it while still down on the trade — the bar is lower than breakeven
  //
  // Verified against live chains: at this price the two returns match to the
  // penny on both sides.
  const denominator = optionType === 'put' ? spot + premium : spot - premium;
  const outperformancePrice = denominator > 0 ? (spot * contract.strike) / denominator : null;
  const outperformanceMovePct =
    outperformancePrice !== null && spot > 0 ? ((outperformancePrice - spot) / spot) * 100 : null;

  return {
    symbol,
    spot,
    expiration,
    dte,
    optionType,
    strike: contract.strike,
    occSymbol: contract.occSymbol,
    delta: contract.delta,
    moneyness: spot > 0 ? contract.strike / spot : null,
    premium,
    bid: contract.bid,
    ask: contract.ask,
    openInterest: contract.openInterest,
    volume: contract.volume,

    ivPct,
    // Premium relative to the two natural denominators. Percent of strike is
    // what the ask was phrased as; percent of spot is the more comparable of
    // the two, since strike drifts with moneyness while spot does not.
    premiumPctOfStrike: contract.strike > 0 ? (premium / contract.strike) * 100 : null,
    premiumPctOfSpot: spot > 0 ? (premium / spot) * 100 : null,
    // One contract controls 100 shares, so this is what one costs — and, for a
    // long option, the most that can be lost.
    capitalAtRisk: premium * 100,

    breakeven,
    breakevenMovePct,
    outperformancePrice,
    outperformanceMovePct,
    impliedMovePct,
    // <1: the breakeven sits inside the move the market is pricing.
    // >1: the stock has to beat expectations just to break even.
    breakevenVsImplied:
      impliedMovePct > 0 && breakevenMovePct !== null
        ? Math.abs(breakevenMovePct) / impliedMovePct
        : null,
  };
}

/** Columns the comparison table offers, with how each should be read. */
export const METRICS = [
  {
    id: 'ivPct',
    label: 'Implied volatility',
    short: 'IV',
    format: (v) => (v === null ? '—' : `${v.toFixed(1)}%`),
    hint: 'The price of volatility itself, normalised for share price and time. The cleanest way to compare names.',
    higherIsExpensive: true,
  },
  {
    id: 'premiumPctOfSpot',
    label: 'Premium, % of share price',
    short: '% of spot',
    format: (v) => (v === null ? '—' : `${v.toFixed(2)}%`),
    hint: 'Cash cost of the option relative to the share price.',
    higherIsExpensive: true,
  },
  {
    id: 'premiumPctOfStrike',
    label: 'Premium, % of strike',
    short: '% of strike',
    format: (v) => (v === null ? '—' : `${v.toFixed(2)}%`),
    hint: 'The same cost measured against the strike rather than the share price.',
    higherIsExpensive: true,
  },
  {
    id: 'breakevenVsImplied',
    label: 'Move needed vs move priced',
    short: 'Needed / priced',
    format: (v) => (v === null ? '—' : `${v.toFixed(2)}×`),
    hint: 'How far the stock must move to break even, divided by the move the market is pricing. Below 1 means the breakeven sits inside the expected range.',
    higherIsExpensive: true,
  },
  {
    id: 'capitalAtRisk',
    label: 'Cost per contract',
    short: 'Cost',
    format: (v) => (v === null ? '—' : `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`),
    hint: 'What one contract costs, and for a long option the most that can be lost.',
    higherIsExpensive: true,
  },
  {
    id: 'breakevenMovePct',
    label: 'Move needed to break even',
    short: 'Breakeven move',
    format: (v) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`),
    hint: 'How far the share price must travel by expiry before the option returns its cost.',
    higherIsExpensive: true,
    magnitude: true,
  },
  {
    id: 'outperformanceMovePct',
    label: 'Move needed to beat the stock',
    short: 'Beat-the-stock move',
    format: (v) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`),
    hint: 'How far the share price must travel before the option\u2019s return on capital beats simply owning the shares. For calls that is further than breakeven, since the shares are gaining too; for puts it is nearer, since the shares are losing.',
    higherIsExpensive: true,
    magnitude: true,
  },
  {
    id: 'impliedMovePct',
    label: 'Move the market is pricing',
    short: 'Implied move',
    format: (v) => (v === null ? '—' : `±${v.toFixed(1)}%`),
    hint: 'The one-standard-deviation move implied by volatility over this horizon.',
    higherIsExpensive: true,
  },
];

/**
 * The number a metric should be *ranked* on, which is not always the number
 * shown. The move columns are signed — a put needs the stock to fall — so a
 * plain descending sort would call the smallest required fall the most
 * demanding. Distance travelled is what those columns actually mean.
 */
export function rankingValue(metric, row) {
  const raw = row?.[metric.id];
  if (!Number.isFinite(raw)) return null;
  return metric.magnitude ? Math.abs(raw) : raw;
}

/** Ranks rows on a metric and returns a sentence naming the extremes. */
export function comparisonVerdict(rows, metricId, matchLabel) {
  const metric = METRICS.find((m) => m.id === metricId);
  if (!metric) return null;
  const usable = rows.filter((r) => rankingValue(metric, r) !== null);
  if (usable.length < 2) return null;

  const sorted = [...usable].sort((a, b) => rankingValue(metric, b) - rankingValue(metric, a));
  const dearest = sorted[0];
  const cheapest = sorted[sorted.length - 1];

  return {
    dearest,
    cheapest,
    headline:
      `At ${matchLabel}, ${dearest.symbol} is the most expensive on ${metric.label.toLowerCase()} ` +
      `(${metric.format(dearest[metricId])}) and ${cheapest.symbol} the least ` +
      `(${metric.format(cheapest[metricId])}).`,
  };
}
