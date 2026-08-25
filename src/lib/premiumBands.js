import { americanOptionPrice } from './contractScreener.js';

/**
 * What this contract's premium is worth on every day between now and expiry,
 * across the range of places the underlying could be by then.
 *
 * The simulator's other charts answer "what if my scenario happens". This one
 * answers the question that comes first: **is this premium rich or cheap right
 * now, and what does the path look like if I am wrong about direction?**
 *
 * ## The bands
 *
 * At each future date the underlying is somewhere in a lognormal cone —
 * `S·exp(±z·σ·√t)`, no drift, the same convention as `forecastCone` in
 * optionAnalytics. The contract is repriced at the edges of that cone with the
 * time it has left by then, giving a premium band that starts as a point today
 * and opens out as the price disperses and closes again as time runs out. Two
 * bands are drawn: one standard deviation, and two.
 *
 * The cone's *width* uses today's implied volatility, because that is the
 * market's own statement about how far the stock can travel. The *pricing*
 * inside the cone uses whatever volatility path the user's IV view describes.
 * Conflating the two would let an IV view silently change the odds of the move
 * as well as the price of it.
 *
 * ## Why it can say "rich" or "cheap" at all
 *
 * Not from the model against the market: implied volatility is *extracted* from
 * the market premium, so pricing a contract at its own IV reproduces its own
 * price exactly, every time. That comparison is circular and worth nothing.
 *
 * The reference used instead is the stock's **realized** volatility — how much
 * it has actually moved over the last 30 trading days. Pricing the same
 * contract at that volatility gives what the premium would be worth if the
 * stock simply carried on as it has been. The gap between the two lines is the
 * volatility risk premium, in dollars rather than vol points, and it is what
 * "overbought" and "oversold" mean here.
 *
 * A positive gap is the *normal* state — sellers charge for bearing risk — so
 * the thresholds below are set well away from zero rather than at it.
 */

/** Trading convention: volatility is quoted per calendar year. */
const CALENDAR_DAYS = 365;

/** Where the premium stops being ordinary. Multiples of realized-vol fair value. */
export const RICH_AT = 1.35;
export const CHEAP_AT = 0.85;

/**
 * Linear ramp of a percentage change across the life of the trade.
 *
 * The existing simulator applies price and IV views this way — all of the move
 * by expiry, proportionally along the way — and this chart has to agree with it
 * or the same scenario would draw two different lines on one page.
 */
function ramp(base, changePct, progress) {
  return base * (1 + (changePct / 100) * progress);
}

/**
 * The premium surface over time.
 *
 * Returns one row per step with the bands, the scenario line, the do-nothing
 * decay line, and the realized-volatility fair line — plus the readings the
 * card states above the plot.
 */
export function premiumBands({
  spot,
  strike,
  dte,
  ivPct,
  optionType = 'call',
  rate = 4,
  priceChangePct = 0,
  ivChangePct = 0,
  realizedVolPct = null,
  marketPremium = 0,
  steps = 48,
  treeSteps = 80,
} = {}) {
  if (!(spot > 0) || !(strike > 0) || !(dte > 0) || !(ivPct > 0)) {
    return { rows: [], fair: null, verdict: null };
  }

  const price = (s, remaining, vol) =>
    americanOptionPrice(s, strike, Math.max(remaining, 0), Math.max(vol, 0.1), rate, optionType, treeSteps);

  const rows = [];
  const points = Math.max(2, Math.min(steps, Math.round(dte)));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i <= points; i += 1) {
    const elapsed = (dte * i) / points;
    const remaining = dte - elapsed;
    const progress = i / points;

    // The cone widens with elapsed time at today's implied volatility.
    const sigma = (ivPct / 100) * Math.sqrt(elapsed / CALENDAR_DAYS);
    const scenarioIV = ramp(ivPct, ivChangePct, progress);
    const scenarioSpot = ramp(spot, priceChangePct, progress);

    const at = (z) => price(spot * Math.exp(z * sigma), remaining, scenarioIV);

    const date = new Date(today);
    date.setDate(date.getDate() + Math.round(elapsed));

    rows.push({
      day: Math.round(elapsed),
      remaining: Math.round(remaining),
      date: date.toISOString().slice(0, 10),
      // Range areas: recharts draws a band straight from a [low, high] pair.
      band2: [at(-2), at(2)],
      band1: [at(-1), at(1)],
      scenario: price(scenarioSpot, remaining, scenarioIV),
      // The do-nothing line: the stock goes nowhere and volatility does not
      // move, so everything you see fall away is time value.
      decay: price(spot, remaining, ivPct),
      fair: realizedVolPct > 0 ? price(spot, remaining, realizedVolPct) : null,
      scenarioSpot,
      scenarioIV,
    });
  }

  const fairNow = realizedVolPct > 0 ? rows[0].fair : null;
  return {
    rows,
    fair: fairNow,
    verdict: premiumVerdict({ marketPremium, fairNow, ivPct, realizedVolPct, optionType }),
  };
}

/**
 * Rich, cheap or fair — and the sentence saying why.
 *
 * Stated in both currencies at once: dollars, because that is what is paid, and
 * volatility points, because that is what is actually being traded.
 */
export function premiumVerdict({ marketPremium, fairNow, ivPct, realizedVolPct, optionType = 'call' }) {
  if (!(marketPremium > 0) || !(fairNow > 0) || !(realizedVolPct > 0)) return null;

  const ratio = marketPremium / fairNow;
  const gap = marketPremium - fairNow;
  const volGap = ivPct - realizedVolPct;
  const money = `$${marketPremium.toFixed(2)} against $${fairNow.toFixed(2)}`;
  const vols = `${ivPct.toFixed(1)}% implied against ${realizedVolPct.toFixed(1)}% realized`;

  if (ratio >= RICH_AT) {
    return {
      tone: 'caution',
      label: 'Rich',
      ratio,
      headline:
        `This ${optionType} costs ${money} — ${ratio.toFixed(2)}× what the stock's own recent movement justifies, ` +
        `a premium of $${gap.toFixed(2)} per share, or $${(gap * 100).toFixed(0)} a contract. In volatility terms that is ` +
        `${vols}, a gap of ${volGap.toFixed(1)} points. Buying here needs the stock to move more than it has been; ` +
        'selling here is being paid above the recent rate.',
    };
  }

  if (ratio <= CHEAP_AT) {
    return {
      tone: 'positive',
      label: 'Cheap',
      ratio,
      headline:
        `This ${optionType} costs ${money} — only ${ratio.toFixed(2)}× what the stock's own recent movement justifies. ` +
        `In volatility terms that is ${vols}, a gap of ${volGap.toFixed(1)} points. Options rarely price below recent ` +
        'realized movement for long, so either the market expects the stock to quieten down, or this is cheap.',
    };
  }

  return {
    tone: 'neutral',
    label: 'Fair',
    ratio,
    headline:
      `This ${optionType} costs ${money}, ${ratio.toFixed(2)}× what the stock's own recent movement justifies — ` +
      `an ordinary premium for bearing the risk. In volatility terms, ${vols}. Neither side of this trade is ` +
      'being handed an edge by the pricing alone.',
  };
}
