/**
 * Axis bounds that read like numbers a person would choose.
 *
 * Recharts rounds its own ticks, but it does so by widening the domain to suit
 * them, which on a series topping out near 850,000% produced an axis reaching
 * 1,800,000% and spent two thirds of the plot on empty space. The way out is to
 * pick the step first, place the ticks on multiples of it, and hand recharts
 * both — at which point it stops improvising.
 */

/** A round step — 1, 2, 2.5 or 5 times a power of ten — giving about `targetTicks` of them. */
export function niceStep(range, targetTicks = 6) {
  if (!(range > 0)) return 1;
  const raw = range / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const rounded = normalized <= 1 ? 1
    : normalized <= 2 ? 2
      : normalized <= 2.5 ? 2.5
        : normalized <= 5 ? 5
          : 10;
  return rounded * magnitude;
}

/**
 * A domain and the ticks to label it with.
 *
 * `floorAt` pins the bottom — premiums cannot go below zero, and an option
 * buyer's loss cannot exceed the premium — so only the top is rounded outward.
 * Left free, the bottom rounds down a whole step and gives away a slice of the
 * plot to a region the data can never enter.
 */
export function niceAxis(low, high, { targetTicks = 6, floorAt = null } = {}) {
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return { domain: ['auto', 'auto'], ticks: undefined, step: 1 };
  }

  const step = niceStep(high - low || Math.abs(high) || 1, targetTicks);
  const lower = floorAt !== null ? floorAt : low - (high - low) * 0.03;
  const upper = Math.ceil(high / step) * step;

  const ticks = [];
  for (let v = Math.ceil(lower / step) * step; v <= upper + step / 2; v += step) {
    // Guard against float drift accumulating across a long run of additions.
    ticks.push(Number((Math.round(v / step) * step).toFixed(10)));
  }

  return { domain: [lower, upper], ticks, step };
}
