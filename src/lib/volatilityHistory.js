/**
 * Historical volatility context: is today's volatility high or low for this
 * name, and for the market as a whole?
 *
 * ## What is and is not computable here
 *
 * "IV Rank" properly means *implied* volatility ranked against its own past
 * year. That requires a year of daily IV observations, and Cboe's free
 * delayed-quotes feed publishes only today's IV — every historical-IV endpoint
 * returns 403. So per-ticker IV rank cannot be computed from this source, and
 * nothing here pretends otherwise.
 *
 * Two honest substitutes are available and are what this module provides:
 *
 *   1. **Realized volatility rank** for the ticker, from its daily closes.
 *      It answers "is this stock moving more than usual?", which is related to
 *      but distinct from "are its options priced richer than usual?".
 *   2. **Market-wide implied volatility rank** from VIX, which *is* a true
 *      implied-volatility series with history back to 1990. This is the right
 *      gauge for "are we in a high-premium environment overall?".
 *
 * Getting real per-ticker IV rank needs either a licensed feed (ORATS,
 * marketdata.app, Polygon) or recording this app's own IV reading once a day
 * and accumulating a year of it.
 *
 * Cboe does publish standalone volatility indices for about twenty underlyings
 * (VXAPL for Apple, VXN for the Nasdaq, GVZ for gold) as real daily IV series.
 * They were charted here briefly and then removed: they cover too few of the
 * names this app is used on to be worth a panel that appears for one ticker and
 * vanishes for the next. See learnings.md if that trade-off is worth revisiting.
 */

const TRADING_DAYS = 252;

/** One year of trading days — the standard lookback for both rank and percentile. */
export const RANK_WINDOW = 252;

/**
 * Spans offered by the range selector on every time-series chart.
 *
 * This only controls how much of a series is *drawn*. Rank and percentile are
 * always measured over `RANK_WINDOW`, because "52-week rank" is a defined term
 * and would stop meaning it if the chart's zoom level changed the number.
 */
export const HISTORY_WINDOWS = [
  { id: '3m', label: '3M', days: 63 },
  { id: '6m', label: '6M', days: 126 },
  { id: '1y', label: '1Y', days: 252 },
  { id: '2y', label: '2Y', days: 504 },
  { id: '5y', label: '5Y', days: 1260 },
];

export const DEFAULT_HISTORY_WINDOW = '1y';

/** Trading days in a window id, falling back to one year. */
export function windowDays(id) {
  return (HISTORY_WINDOWS.find((w) => w.id === id) || HISTORY_WINDOWS[2]).days;
}

/**
 * The two ways practitioners rank a volatility reading. Both are shown because
 * they disagree in exactly the situation that matters most.
 */
export const RANK_METHODS = {
  rank: {
    id: 'rank',
    label: 'Rank',
    blurb: 'Where today sits between the 52-week low and high',
  },
  percentile: {
    id: 'percentile',
    label: 'Percentile',
    blurb: 'Share of the last 52 weeks spent below today',
  },
};

/**
 * Rank and percentile of `current` against `series` (most recent last).
 *
 * The distinction is worth internalising:
 *
 *   - **Rank** is `(current − low) / (high − low)`. It only looks at the two
 *     extremes, so a single spike a year ago drags every subsequent reading
 *     toward zero and keeps it there until that spike rolls out of the window.
 *   - **Percentile** is the share of days that closed below today. It uses the
 *     whole distribution and is unmoved by one outlier.
 *
 * A name that spiked once and has been calm since will show a low rank and a
 * high percentile at the same time. Neither is wrong; they answer different
 * questions, so both are returned.
 */
export function rankAndPercentile(series, current, window = RANK_WINDOW) {
  const values = (series || [])
    .slice(-window)
    .map((v) => (typeof v === 'number' ? v : v?.value))
    .filter((v) => Number.isFinite(v));

  if (values.length < 20 || !Number.isFinite(current)) return null;

  const low = Math.min(...values);
  const high = Math.max(...values);
  const below = values.filter((v) => v < current).length;

  return {
    current,
    low,
    high,
    observations: values.length,
    // A flat series has no range to sit inside; report the midpoint rather than
    // dividing by zero.
    rank: high > low ? ((current - low) / (high - low)) * 100 : 50,
    percentile: (below / values.length) * 100,
  };
}

/**
 * Rolling annualized realized volatility, as a percentage, one point per day.
 *
 * Uses log returns and a sample standard deviation over `window` trading days,
 * matching `realizedVol` in optionAnalytics so the latest point of this series
 * equals the single number shown elsewhere on the page.
 */
export function realizedVolSeries(history, window = 30) {
  if (!Array.isArray(history) || history.length < window + 2) return [];

  const returns = [];
  for (let i = 1; i < history.length; i += 1) {
    const prev = Number(history[i - 1].close);
    const close = Number(history[i].close);
    if (prev > 0 && close > 0) returns.push({ date: history[i].date, r: Math.log(close / prev) });
    else returns.push({ date: history[i].date, r: null });
  }

  const out = [];
  for (let i = window - 1; i < returns.length; i += 1) {
    const slice = returns.slice(i - window + 1, i + 1).map((x) => x.r).filter((r) => r !== null);
    if (slice.length < window * 0.8) continue; // too many gaps to trust

    const mean = slice.reduce((s, r) => s + r, 0) / slice.length;
    const variance = slice.reduce((s, r) => s + (r - mean) ** 2, 0) / (slice.length - 1);
    out.push({ date: returns[i].date, value: Math.sqrt(variance * TRADING_DAYS) * 100 });
  }

  return out;
}

/** Daily closes of a volatility index (VIX and friends) as a plain series. */
export function volIndexSeries(history) {
  return (history || [])
    .filter((bar) => Number(bar.close) > 0)
    .map((bar) => ({ date: bar.date, value: Number(bar.close) }));
}

/**
 * Trims a series to roughly the last `years` of trading days and thins it so a
 * chart draws a few hundred points rather than several thousand.
 */
export function trimForChart(series, years = 2, maxPoints = 400) {
  const wanted = Math.round(years * TRADING_DAYS);
  const recent = series.slice(-wanted);
  if (recent.length <= maxPoints) return recent;

  const step = Math.ceil(recent.length / maxPoints);
  const thinned = recent.filter((_, i) => i % step === 0);
  // Always keep the newest point: it is the one the rank refers to.
  if (thinned[thinned.length - 1] !== recent[recent.length - 1]) thinned.push(recent[recent.length - 1]);
  return thinned;
}

/**
 * A rolling rank series, so the chart can show how the ranking itself moved
 * rather than only where it stands today.
 */
export function rollingRankSeries(series, { window = RANK_WINDOW, method = 'rank' } = {}) {
  const out = [];
  for (let i = window; i < series.length; i += 1) {
    const stats = rankAndPercentile(series.slice(i - window, i + 1), series[i].value, window + 1);
    if (stats) out.push({ date: series[i].date, value: method === 'percentile' ? stats.percentile : stats.rank });
  }
  return out;
}

/** Plain-English reading of a rank or percentile figure. */
export function rankVerdict(value, { subject = 'Volatility', method = 'rank' } = {}) {
  if (!Number.isFinite(value)) return null;
  const measure = method === 'percentile' ? 'percentile' : 'rank';

  if (value >= 75) {
    return {
      tone: 'caution',
      headline: `${subject} is high by its own recent standards — ${measure} ${value.toFixed(0)}. Options are expensive here, which favours selling premium over buying it.`,
    };
  }
  if (value <= 25) {
    return {
      tone: 'info',
      headline: `${subject} is low by its own recent standards — ${measure} ${value.toFixed(0)}. Options are cheap here, which favours buying premium over selling it.`,
    };
  }
  return {
    tone: 'neutral',
    headline: `${subject} sits mid-range — ${measure} ${value.toFixed(0)}. Neither notably rich nor notably cheap against the last year.`,
  };
}
