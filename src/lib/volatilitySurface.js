/**
 * The implied-volatility surface, sliced for comparison across companies.
 *
 * ## The vocabulary, since it is used loosely everywhere
 *
 *   - **Smile** — implied volatility against strike for a *single* expiration.
 *     Named for the FX shape, which curves up on both sides.
 *   - **Skew** — the *tilt* of that curve. Equity options almost always slope
 *     down, puts richer than calls, so "skew" is what practitioners say when
 *     they mean the equity smile.
 *   - **Term structure** — at-the-money volatility across expirations.
 *   - **Surface** — both at once: volatility as a function of moneyness and
 *     time.
 *
 * ## Why moneyness rather than strike
 *
 * Strikes are not comparable across companies. Expressing the curve against
 * strike ÷ spot puts every name on one axis, so a $90 stock and a $300 stock
 * can be read on the same chart.
 *
 * ## Why the normalised view exists
 *
 * Raw volatility conflates two different questions. "MSTR is at 70% and KO at
 * 17%" says one is a wilder stock; it says nothing about whether either is
 * pricing tails unusually. Dividing each curve by its own at-the-money level
 * strips the first question out and leaves the second: whose curve is *steeper*,
 * relative to its own baseline — which is the one that says who is paying up for
 * a big move rather than merely for a volatile underlying.
 */

import { contractsFor } from './optionAnalytics.js';

/**
 * Implied volatility at an arbitrary moneyness, interpolated between quoted
 * strikes. Returns null outside the quoted range rather than extrapolating a
 * volatility nobody offered.
 */
export function ivAtMoneyness(chain, expiration, optionType, spot, moneyness) {
  if (!chain || !(spot > 0)) return null;

  const { calls, puts } = contractsFor(chain, expiration);
  const points = (optionType === 'put' ? puts : calls)
    .filter((c) => c.implied_volatility > 0 && c.strike > 0)
    .map((c) => ({ x: c.strike / spot, iv: c.implied_volatility * 100 }))
    .sort((a, b) => a.x - b.x);

  if (points.length < 2) return null;
  if (moneyness < points[0].x || moneyness > points[points.length - 1].x) return null;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (moneyness <= b.x) {
      const span = b.x - a.x;
      if (span === 0) return b.iv;
      return a.iv + ((moneyness - a.x) * (b.iv - a.iv)) / span;
    }
  }
  return points[points.length - 1].iv;
}

/** At-the-money volatility for one side, used as the normalising baseline. */
export function atmFor(chain, expiration, optionType, spot) {
  return ivAtMoneyness(chain, expiration, optionType, spot, 1);
}

/**
 * The smile: volatility across moneyness for one expiration and one side.
 * `normalise` divides by the at-the-money level so curve *shape* is comparable
 * between names with very different absolute volatility.
 */
export function smileCurve(chain, expiration, optionType, spot, {
  from = 0.7, to = 1.3, steps = 31, normalise = false,
} = {}) {
  const atm = normalise ? atmFor(chain, expiration, optionType, spot) : null;
  if (normalise && !(atm > 0)) return [];

  const out = [];
  for (let i = 0; i < steps; i += 1) {
    const moneyness = from + ((to - from) * i) / (steps - 1);
    const iv = ivAtMoneyness(chain, expiration, optionType, spot, moneyness);
    if (iv === null) continue;
    out.push({ moneyness, iv: normalise ? iv / atm : iv });
  }
  return out;
}

/**
 * The term structure at a fixed moneyness: volatility against days to expiry.
 * Holding moneyness constant rather than following the at-the-money strike is
 * what makes two names comparable at the same point on their curves.
 */
export function termCurve(chain, expirations, optionType, spot, moneyness, { normalise = false } = {}) {
  const out = [];
  for (const e of expirations) {
    const iv = ivAtMoneyness(chain, e.expiration, optionType, spot, moneyness);
    if (iv === null) continue;

    let value = iv;
    if (normalise) {
      const atm = atmFor(chain, e.expiration, optionType, spot);
      if (!(atm > 0)) continue;
      value = iv / atm;
    }
    out.push({ dte: e.dte, expiration: e.expiration, iv: value });
  }
  return out.sort((a, b) => a.dte - b.dte);
}

/**
 * One number for the tilt: volatility 10% below spot minus volatility 10% above,
 * in volatility points.
 *
 * Positive is the normal equity shape — downside protection dearer than upside.
 * A steeper positive figure means the market is charging more for a crash than
 * its at-the-money level alone implies. Measured on the same side of the book
 * for both legs so it reflects curve shape rather than the call/put spread.
 */
export function skewSlope(chain, expiration, optionType, spot, { width = 0.1 } = {}) {
  const low = ivAtMoneyness(chain, expiration, optionType, spot, 1 - width);
  const high = ivAtMoneyness(chain, expiration, optionType, spot, 1 + width);
  if (low === null || high === null) return null;
  return low - high;
}

/** Plain-English reading of a set of curves, naming the extremes. */
export function surfaceVerdict(series, { normalised, atMoneyness }) {
  const usable = series.filter((s) => s.skew !== null && s.skew !== undefined);
  if (usable.length < 2) return null;

  const steepest = usable.reduce((b, s) => (s.skew > b.skew ? s : b), usable[0]);
  const flattest = usable.reduce((b, s) => (s.skew < b.skew ? s : b), usable[0]);

  const where = atMoneyness ? ` at ${(atMoneyness * 100).toFixed(0)}% of spot` : '';
  const basis = normalised
    ? 'relative to its own at-the-money level, so this is about curve shape rather than how volatile the stock is'
    : 'in outright volatility points';

  return `${steepest.symbol} has the steepest curve${where} — ${steepest.skew.toFixed(1)} points ` +
    `richer 10% below spot than 10% above — and ${flattest.symbol} the flattest at ` +
    `${flattest.skew.toFixed(1)}. Read ${basis}.`;
}
