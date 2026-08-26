import { americanOptionPrice } from './contractScreener.js';
import { realizedVolSeries } from './volatilityHistory.js';

/**
 * Is this premium expensive, given how much time is left and where the stock is?
 *
 * ## Why this is not a comparison against the model
 *
 * Implied volatility is *extracted* from the premium. Price a contract at its
 * own IV and the binomial tree hands back the price it started from, to the
 * cent, every time. Any "the model says this is overpriced" built on that is
 * circular, and it will look convincing while being worthless.
 *
 * So everything here is measured against a **benchmark volatility** supplied by
 * the caller — by default the stock's own realized volatility over the last 30
 * trading days, which is an independent measurement of how much it has actually
 * been moving. The difference between pricing at the market's volatility and
 * pricing at that benchmark is the volatility risk premium, in dollars. That is
 * what "expensive" means here, and it is the only thing this module claims.
 *
 * A positive gap is the *normal* state, since sellers charge for bearing risk.
 * The thresholds sit well away from zero for that reason.
 *
 * ## The three views
 *
 *   - `richnessGrid` — the gap at every combination of price and date, so the
 *     question is answered across the whole domain rather than at one point,
 *     with the scenario's own path drawn through it.
 *   - `decayCurves` — premium against price at several times to expiry, priced
 *     both ways. The gap between the two families of curves is the same
 *     quantity, seen as a shape rather than as a colour.
 *   - `volDistribution` — the volatility being paid against every 30-day
 *     volatility the stock has actually delivered, which turns "expensive" into
 *     a percentile.
 */

/** Volatility is quoted per calendar year. */
const CALENDAR_DAYS = 365;

/** Where a premium stops being an ordinary risk charge. Multiples of benchmark value. */
export const RICH_AT = 1.35;
export const CHEAP_AT = 0.85;

/**
 * A percentage change applied proportionally across the life of the trade.
 *
 * The simulator's other charts ramp price and IV views this way, and these have
 * to agree with them or one scenario would draw two different pictures on one
 * page.
 */
function ramp(base, changePct, progress) {
  return base * (1 + (changePct / 100) * progress);
}

/**
 * A binomial price with its own sawtooth damped out.
 *
 * A tree of fixed depth prices a step function of spot: its terminal nodes land
 * on discrete prices, and whether the strike falls on a node or between two of
 * them shifts the answer slightly. Ordinarily invisible. It stops being
 * invisible the moment two nearly equal prices are subtracted — the curves of
 * `decayCurves` in overpay mode came out visibly stepped, because a 3% wobble
 * on each price is a 30% wobble on a gap a tenth their size.
 *
 * Deepening the tree barely helps: the oscillation persists, it just moves.
 * Averaging depths `n` and `n+1` puts the two halves of the oscillation against
 * each other and cuts the roughness roughly threefold for twice the work, which
 * is the standard remedy and much cheaper than the depth that would be needed
 * otherwise (300 steps took 1.6 seconds and was still rougher).
 */
function smoothPrice(spot, strike, days, vol, rate, optionType, steps) {
  return (
    americanOptionPrice(spot, strike, days, vol, rate, optionType, steps)
    + americanOptionPrice(spot, strike, days, vol, rate, optionType, steps + 1)
  ) / 2;
}

/** The scenario's price and volatility a given fraction of the way to expiry. */
function scenarioAt(progress, { spot, ivPct, priceChangePct, ivChangePct }) {
  return {
    spot: ramp(spot, priceChangePct, progress),
    iv: Math.max(ramp(ivPct, ivChangePct, progress), 0.1),
  };
}

/**
 * The price axis both grid and curves share: wide enough to hold the scenario's
 * target and a standard deviation of drift either side of it, so the path never
 * runs off its own chart.
 */
export function priceAxis({ spot, ivPct, dte, priceChangePct = 0, steps = 16 }) {
  const sigma = (ivPct / 100) * Math.sqrt(Math.max(dte, 1) / CALENDAR_DAYS);
  const target = spot * (1 + priceChangePct / 100);
  const low = Math.min(spot * Math.exp(-1.5 * sigma), target * 0.95);
  const high = Math.max(spot * Math.exp(1.5 * sigma), target * 1.05);

  const out = [];
  for (let i = 0; i <= steps; i += 1) out.push(low + ((high - low) * i) / steps);
  return out;
}

/**
 * A local calendar date, never `toISOString`.
 *
 * `toISOString` converts to UTC first, so local midnight in any timezone ahead
 * of UTC lands on the previous day — CEST shifted this whole axis back by one,
 * labelling today's column as yesterday.
 */
function localISODate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Evenly spaced dates from today to expiry, with the days left at each. */
function timeAxis(dte, steps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const elapsed = (dte * i) / steps;
    const date = new Date(today);
    date.setDate(date.getDate() + Math.round(elapsed));
    out.push({
      progress: i / steps,
      elapsed,
      remaining: dte - elapsed,
      date: localISODate(date),
    });
  }
  return out;
}

/**
 * How much dearer than the benchmark this contract is, at every price and date.
 *
 * The cell value is a **dollar gap**, not a ratio. A ratio is unbounded where
 * both numbers are pennies — a two-cent contract worth one cent at the
 * benchmark reads as 100% rich and colours the whole out-of-the-money corner
 * scarlet, which is true and useless. The dollar gap peaks near the money and
 * near the front, which is where the money actually is.
 */
export function richnessGrid({
  spot,
  strike,
  dte,
  ivPct,
  benchmarkVolPct,
  optionType = 'call',
  rate = 4,
  priceChangePct = 0,
  ivChangePct = 0,
  priceSteps = 16,
  timeSteps = 12,
  // The grid shows numbers in cells and colours a wide ramp, so the sawtooth is
  // below what anyone can see; it does not need the averaging the curves do.
  treeSteps = 80,
} = {}) {
  if (!(spot > 0) || !(strike > 0) || !(dte > 0) || !(ivPct > 0) || !(benchmarkVolPct > 0)) {
    return { prices: [], times: [], cells: [], extent: 0, path: [] };
  }

  const prices = priceAxis({ spot, ivPct, dte, priceChangePct, steps: priceSteps });
  const times = timeAxis(dte, timeSteps);

  const cells = [];
  let extent = 0;

  for (const time of times) {
    const { iv } = scenarioAt(time.progress, { spot, ivPct, priceChangePct, ivChangePct });
    const row = [];
    for (const price of prices) {
      const market = americanOptionPrice(price, strike, time.remaining, iv, rate, optionType, treeSteps);
      const benchmark = americanOptionPrice(price, strike, time.remaining, benchmarkVolPct, rate, optionType, treeSteps);
      const gap = market - benchmark;
      if (Math.abs(gap) > extent) extent = Math.abs(gap);
      row.push({ price, gap, market, benchmark, ratio: benchmark > 0 ? market / benchmark : null });
    }
    cells.push({ ...time, iv, row });
  }

  // Where the scenario walks through the grid: one price per column, snapped to
  // the nearest row so it can be drawn as cells rather than as a floating line.
  const path = times.map((time, column) => {
    const { spot: at } = scenarioAt(time.progress, { spot, ivPct, priceChangePct, ivChangePct });
    let nearest = 0;
    for (let i = 1; i < prices.length; i += 1) {
      if (Math.abs(prices[i] - at) < Math.abs(prices[nearest] - at)) nearest = i;
    }
    return { column, row: nearest, price: at, date: time.date };
  });

  return { prices, times, cells, extent, path };
}

/**
 * Premium against price at several times to expiry, priced at the market's
 * volatility and at the benchmark.
 *
 * This is the textbook picture of an option's value, and the reason to draw it
 * twice is that the space between the two families is the thing being paid for.
 * It reads as a shape: wide where the volatility premium is large, pinched to
 * nothing at expiry where only intrinsic value is left.
 */
export function decayCurves({
  spot,
  strike,
  dte,
  ivPct,
  benchmarkVolPct,
  optionType = 'call',
  rate = 4,
  priceChangePct = 0,
  ivChangePct = 0,
  slices = [1, 0.66, 0.33, 0],
  priceSteps = 32,
  treeSteps = 81,
} = {}) {
  if (!(spot > 0) || !(strike > 0) || !(dte > 0) || !(ivPct > 0)) return { rows: [], series: [] };

  const prices = priceAxis({ spot, ivPct, dte, priceChangePct, steps: priceSteps });

  const series = slices.map((fraction, i) => {
    const progress = 1 - fraction;
    const { iv } = scenarioAt(progress, { spot, ivPct, priceChangePct, ivChangePct });
    return {
      key: `t${i}`,
      remaining: dte * fraction,
      label: fraction === 0 ? 'At expiry' : `${Math.round(dte * fraction)} days left`,
      iv,
    };
  });

  const rows = prices.map((price) => {
    const row = { price };
    for (const s of series) {
      row[s.key] = smoothPrice(price, strike, s.remaining, s.iv, rate, optionType, treeSteps);
      row[`${s.key}fair`] = benchmarkVolPct > 0
        ? smoothPrice(price, strike, s.remaining, benchmarkVolPct, rate, optionType, treeSteps)
        : null;
    }
    return row;
  });

  return { rows, series };
}

/**
 * Every 30-day volatility the stock has actually delivered, as a histogram, and
 * where the volatility being paid sits in it.
 *
 * The sharpest form of the question and the smallest chart: not "implied is
 * five points above realized", which needs interpreting, but "you are paying a
 * level this stock has exceeded on 22% of the days in two years", which does not.
 */
export function volDistribution(history, { ivPct, window = 30, bins = 24, years = 2 } = {}) {
  const series = realizedVolSeries(history, window).slice(-Math.round(years * 252));
  if (series.length < 60) return null;

  const values = series.map((p) => p.value).filter((v) => v > 0);
  const low = Math.min(...values, ivPct);
  const high = Math.max(...values, ivPct);
  const width = (high - low) / bins || 1;

  const buckets = Array.from({ length: bins }, (_, i) => ({
    from: low + i * width,
    to: low + (i + 1) * width,
    mid: low + (i + 0.5) * width,
    count: 0,
  }));

  for (const v of values) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor((v - low) / width)));
    buckets[i].count += 1;
  }

  const above = values.filter((v) => v > ivPct).length;
  return {
    buckets,
    observations: values.length,
    // The share of the past that was *more* volatile than what is being paid
    // for now — the number a buyer actually wants, since that is how often the
    // stock would have justified this price.
    aboveShare: (above / values.length) * 100,
    median: [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)],
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/**
 * Rich, cheap or fair — stated in both currencies at once: dollars, because that
 * is what is paid, and volatility points, because that is what is traded.
 */
export function premiumVerdict({
  marketPremium, benchmarkValue, ivPct, benchmarkVolPct, optionType = 'call', aboveShare = null,
}) {
  if (!(marketPremium > 0) || !(benchmarkValue > 0) || !(benchmarkVolPct > 0)) return null;

  const ratio = marketPremium / benchmarkValue;
  const gap = marketPremium - benchmarkValue;
  const volGap = ivPct - benchmarkVolPct;
  const history = aboveShare === null
    ? ''
    : ` The stock has actually moved faster than this on ${aboveShare.toFixed(0)}% of the last two years.`;
  const money = `$${marketPremium.toFixed(2)} against $${benchmarkValue.toFixed(2)}`;
  const vols = `${ivPct.toFixed(1)}% implied against ${benchmarkVolPct.toFixed(1)}%`;

  if (ratio >= RICH_AT) {
    return {
      tone: 'caution',
      label: 'Rich',
      ratio,
      headline:
        `This ${optionType} costs ${money} — ${ratio.toFixed(2)}× the benchmark, an overpay of $${gap.toFixed(2)} a share ` +
        `or $${(gap * 100).toFixed(0)} a contract. In volatility terms, ${vols}, a gap of ${volGap.toFixed(1)} points.` +
        `${history} Buying here needs the stock to move more than it has been.`,
    };
  }

  if (ratio <= CHEAP_AT) {
    return {
      tone: 'positive',
      label: 'Cheap',
      ratio,
      headline:
        `This ${optionType} costs ${money} — only ${ratio.toFixed(2)}× the benchmark. In volatility terms, ${vols}, ` +
        `a gap of ${volGap.toFixed(1)} points.${history} Premium rarely sits below delivered movement for long: either ` +
        'the market expects this to quieten down, or it is cheap.',
    };
  }

  return {
    tone: 'neutral',
    label: 'Fair',
    ratio,
    headline:
      `This ${optionType} costs ${money}, ${ratio.toFixed(2)}× the benchmark — an ordinary charge for bearing the risk. ` +
      `In volatility terms, ${vols}.${history} Neither side is handed an edge by the pricing alone.`,
  };
}
