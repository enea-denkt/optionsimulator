/**
 * Which contract pays best if a view comes true.
 *
 * The simulator answers "how does *this* position behave?". This answers the
 * question that comes before it: given a view on the share price, which of the
 * few thousand listed contracts turns that view into the most money?
 *
 * ## What is being maximised
 *
 * Return on the premium paid, not dollars of profit. A contract costing $0.40
 * that finishes worth $2 beats one costing $40 that finishes worth $60, because
 * the first turns each dollar risked into five and the second into one and a
 * half. That is the honest comparison when the alternatives cost wildly
 * different amounts.
 *
 * ## Two valuations, and why they disagree
 *
 *   - **At expiration.** Nothing is left but intrinsic value, so the answer is
 *     exact: `max(target − strike, 0)` against what you paid. No model, no
 *     volatility assumption. This is why implied volatility does not appear in
 *     it — an IV view cannot change what a contract is worth at expiry.
 *   - **If it happens now.** The same move arriving today, with time value still
 *     on the contract, priced through the same binomial tree the simulator uses
 *     and with the IV view applied. This is where an IV assumption earns its
 *     keep, and it is usually the larger number, because you are selling back
 *     the time value you paid for instead of watching it decay to nothing.
 *
 * ## Which volatility a contract carries after the move
 *
 * This matters more than it sounds, and getting it wrong wrecks the ranking.
 *
 * A far out-of-the-money wing option is quoted at a much higher implied
 * volatility than the money — MSTR's $420 call at 154% against 74% at the
 * money. Hold that 154% fixed and then move spot 20% toward the strike, and the
 * model says a contract you bought for four cents is now worth seventy: a
 * 1,600% return, on a contract that expires worthless at the same target price.
 * Ranking by it surfaces nothing but those artifacts.
 *
 * The fix is to let volatility slide along the smile rather than stick to the
 * strike. After a move, a contract sits at a new moneyness, and what it should
 * be quoted at is what that moneyness is quoted at *today* — read straight off
 * the chain's own smile for its expiration. So the wing call, as it comes toward
 * the money, gives up its wing volatility on the way in, which is what actually
 * happens. `ivChangePct` is then applied on top of that, as a shift of the whole
 * smile, which is what an IV view really is.
 *
 * Both are reported for every contract. Ranking by the first favours cheap
 * far-dated leverage; ranking by the second favours contracts with the most
 * time value to gain, which is a different list.
 *
 * ## What it deliberately does not do
 *
 * It does not weight by probability. The top of any such list is the contract
 * that only pays if you are exactly right, and its delta — shown in the table —
 * is roughly the market's odds of that. A screen that maximises return without
 * saying so would be selling lottery tickets; the odds sit in the next column.
 */

/** The rate the simulator assumes, so both pages price the same contract alike. */
export const RISK_FREE_RATE = 4;

/** How much open interest a contract needs before it is worth listing. */
export const LIQUIDITY_FILTERS = [
  { id: 'any', label: 'Any', minOpenInterest: 0, blurb: 'Everything listed, including contracts nobody holds' },
  { id: 'some', label: '25+', minOpenInterest: 25, blurb: 'Skips contracts with almost no open interest' },
  { id: 'liquid', label: '100+', minOpenInterest: 100, blurb: 'Reasonably traded contracts only' },
  { id: 'deep', label: '1,000+', minOpenInterest: 1000, blurb: 'Only the crowded strikes' },
];

/**
 * Ranking by return alone fills the top of the list with adjacent strikes on the
 * same expiry — the six calls either side of the money all score within a point
 * of each other, and the chart draws six copies of one line. Collapsing to the
 * best contract per expiration answers a different and often more useful
 * question: given each date, what is the best way to play it.
 */
export const VARIETY_MODES = [
  { id: 'all', label: 'Every contract', blurb: 'The literal ranking, adjacent strikes included' },
  { id: 'expiry', label: 'Best per expiry', blurb: 'One winner per expiration date, so the list spans the calendar' },
];

export const RANK_BASES = [
  { id: 'expiry', label: 'At expiration', blurb: 'Intrinsic value at expiry against what you paid' },
  { id: 'now', label: 'If it happens now', blurb: 'Repriced today with time value and your IV view' },
];

/** Value of an option at expiry — the only valuation that needs no model. */
export function intrinsic(spot, strike, optionType) {
  return optionType === 'call' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

/**
 * American option price by binomial tree.
 *
 * Volatility and rate are percentages and `timeToExpiry` is in days, matching
 * how the rest of the app carries them. Lifted unchanged from the simulator so
 * that one pricer serves both pages: a contract cannot be worth one number on
 * the finder and another on the simulator.
 */
export function americanOptionPrice(
  spotPrice,
  strikePrice,
  timeToExpiry,
  volatility,
  riskFreeRate,
  optionType = 'call',
  steps = 100,
) {
  const T = timeToExpiry / 365;
  const v = volatility / 100;
  const r = riskFreeRate / 100;

  if (T <= 0 || !(v > 0)) return intrinsic(spotPrice, strikePrice, optionType);

  const dt = T / steps;
  const u = Math.exp(v * Math.sqrt(dt));
  const d = 1 / u;
  const p = (Math.exp(r * dt) - d) / (u - d);
  const discount = Math.exp(-r * dt);

  const values = new Array(steps + 1);
  for (let i = 0; i <= steps; i += 1) {
    const price = spotPrice * u ** (steps - i) * d ** i;
    values[i] = intrinsic(price, strikePrice, optionType);
  }

  for (let step = steps - 1; step >= 0; step -= 1) {
    for (let i = 0; i <= step; i += 1) {
      const price = spotPrice * u ** (step - i) * d ** i;
      const hold = discount * (p * values[i] + (1 - p) * values[i + 1]);
      // American: exercising early is always available, so the option can never
      // be worth less than what exercising would hand you today.
      values[i] = Math.max(hold, intrinsic(price, strikePrice, optionType));
    }
  }

  return values[0];
}

/**
 * The chain's implied-volatility curve for one expiration: strike against IV,
 * sorted, with calls and puts averaged where both quote a strike.
 *
 * Two bits of hygiene, both of which showed up as visible damage before they
 * were added. Strikes with no bid are dropped, because a dead strike's IV is
 * whatever the exchange's model returned for a stale quote and it sits well off
 * the curve its neighbours describe. What survives is then smoothed with a
 * three-point kernel: the curve is read at a strike that slides continuously as
 * the price axis moves, so a single ragged point becomes a spike in every
 * contract's return line that passes over it.
 */
function smileFor(contracts) {
  const byStrike = new Map();
  for (const c of contracts) {
    if (!(c.implied_volatility > 0)) continue;
    if (!(Number(c.bid) > 0)) continue;
    const entry = byStrike.get(c.strike) || { strike: c.strike, sum: 0, n: 0 };
    entry.sum += c.implied_volatility * 100;
    entry.n += 1;
    byStrike.set(c.strike, entry);
  }

  const raw = [...byStrike.values()]
    .map((e) => ({ strike: e.strike, iv: e.sum / e.n }))
    .sort((a, b) => a.strike - b.strike);

  if (raw.length < 3) return raw;

  return raw.map((point, i) => ({
    strike: point.strike,
    iv: (raw[Math.max(0, i - 1)].iv + 2 * point.iv + raw[Math.min(raw.length - 1, i + 1)].iv) / 4,
  }));
}

/**
 * The curve read at an arbitrary strike, flat beyond its ends.
 *
 * Extrapolating the wings would be worse than holding them flat: the smile
 * steepens without bound in the tails and a linear continuation invents
 * volatility the chain never quoted.
 */
function ivAt(curve, strike) {
  if (!curve?.length) return null;
  if (strike <= curve[0].strike) return curve[0].iv;
  if (strike >= curve[curve.length - 1].strike) return curve[curve.length - 1].iv;

  for (let i = 1; i < curve.length; i += 1) {
    if (curve[i].strike >= strike) {
      const a = curve[i - 1];
      const b = curve[i];
      const t = (strike - a.strike) / (b.strike - a.strike);
      return a.iv + t * (b.iv - a.iv);
    }
  }
  return curve[curve.length - 1].iv;
}

/**
 * The volatility a contract should carry once the underlying is at `price`.
 *
 * Sticky moneyness: the contract slides to a new position on the smile, and is
 * quoted at whatever that position is quoted at today. The IV view shifts the
 * whole curve on top of that.
 */
export function scenarioIV(row, { spot, price, ivChangePct = 0 }) {
  if (!(spot > 0) || !(price > 0)) return null;
  const base = ivAt(row.ivCurve, (row.strike * spot) / price) ?? row.iv;
  return base === null ? null : Math.max(base * (1 + ivChangePct / 100), 0.1);
}

/** What you would actually pay to open: the ask, or the mark when none is quoted. */
function entryPrice(contract) {
  const ask = Number(contract.ask);
  if (ask > 0) return ask;
  const mark = Number(contract.mark);
  return mark > 0 ? mark : 0;
}

/** Every contract in the chain as a flat list, with its days to expiry attached. */
function flatten(chain, today) {
  const out = [];
  const midnight = new Date(today);
  midnight.setHours(0, 0, 0, 0);

  for (const side of ['call', 'put']) {
    for (const list of Object.values(chain?.contracts?.[side] || {})) {
      for (const contract of list) {
        const [y, m, d] = contract.expiration.split('-').map(Number);
        const dte = Math.round((new Date(y, m - 1, d) - midnight) / 86400000);
        out.push({ ...contract, dte });
      }
    }
  }
  return out;
}

/**
 * Score every contract in the chain against a view and return them ranked.
 *
 * `priceChangePct` is the move expected in the underlying; `ivChangePct` is the
 * expected change in that contract's own implied volatility, which affects the
 * "if it happens now" valuation only.
 */
export function screenContracts(chain, {
  priceChangePct = 0,
  ivChangePct = 0,
  minDte = 0,
  maxDte = 3650,
  side = 'both',
  minOpenInterest = 0,
  requireBid = true,
  rate = RISK_FREE_RATE,
  rankBy = 'expiry',
  today = new Date(),
} = {}) {
  const spot = Number(chain?.stockPrice) || 0;
  // Every stage of the funnel is counted, because "13 contracts screened" is an
  // alarming number without the sentence that explains it, and the explanation
  // is never the same twice: sometimes one expiration exists in the window,
  // sometimes half the chain is adjusted, sometimes it is the filters.
  const counts = { inWindow: 0, side: 0, openInterest: 0, bid: 0, priced: 0, expirations: 0 };
  if (!(spot > 0)) return { rows: [], counts };

  const target = spot * (1 + priceChangePct / 100);
  const all = flatten(chain, today);

  // One smile per expiration, built once and shared by reference across every
  // row on that date — the alternative is rebuilding it inside the loop.
  const smiles = new Map();
  for (const contract of all) {
    if (!smiles.has(contract.expiration)) {
      smiles.set(contract.expiration, all.filter((c) => c.expiration === contract.expiration));
    }
  }
  for (const [expiration, contracts] of smiles) smiles.set(expiration, smileFor(contracts));

  const rows = [];

  const expirationsSeen = new Set();

  for (const contract of all) {
    if (contract.dte < minDte || contract.dte > maxDte) continue;
    counts.inWindow += 1;
    expirationsSeen.add(contract.expiration);

    if (side !== 'both' && contract.optionType !== side) continue;
    counts.side += 1;

    if (Number(contract.openInterest || 0) < minOpenInterest) continue;
    counts.openInterest += 1;

    // No bid means nobody is buying at any price. The ask is then a quote, not a
    // market, and a return computed against it is arithmetic rather than money.
    if (requireBid && !(Number(contract.bid) > 0)) continue;
    counts.bid += 1;

    const entry = entryPrice(contract);
    if (!(entry > 0)) continue;
    counts.priced += 1;

    const iv = Number(contract.implied_volatility) > 0 ? contract.implied_volatility * 100 : null;

    const atExpiry = intrinsic(target, contract.strike, contract.optionType);
    const ivCurve = smiles.get(contract.expiration) || null;
    // Without a quoted IV there is nothing to reprice from, so the "now" column
    // is left empty rather than filled with a guessed volatility.
    const moved = iv === null
      ? null
      : scenarioIV({ strike: contract.strike, iv, ivCurve }, { spot, price: target, ivChangePct });
    const now = moved === null
      ? null
      : americanOptionPrice(target, contract.strike, contract.dte, moved, rate, contract.optionType);

    const breakeven = contract.optionType === 'call'
      ? contract.strike + entry
      : contract.strike - entry;

    rows.push({
      occSymbol: contract.occSymbol,
      optionType: contract.optionType,
      strike: contract.strike,
      expiration: contract.expiration,
      dte: contract.dte,
      root: contract.root,
      isStandardRoot: contract.isStandardRoot,
      bid: Number(contract.bid) || 0,
      ask: Number(contract.ask) || 0,
      entry,
      cost: entry * 100,
      iv,
      ivCurve,
      movedIV: moved,
      delta: Number.isFinite(contract.delta) ? contract.delta : null,
      openInterest: Number(contract.openInterest) || 0,
      volume: Number(contract.volume) || 0,
      valueAtExpiry: atExpiry,
      returnAtExpiryPct: (atExpiry / entry - 1) * 100,
      profitAtExpiry: (atExpiry - entry) * 100,
      valueNow: now,
      returnNowPct: now === null ? null : (now / entry - 1) * 100,
      breakeven,
      moveToBreakevenPct: (breakeven / spot - 1) * 100,
    });
  }

  counts.expirations = expirationsSeen.size;
  return { rows: sortRows(rows, rankBy), counts };
}

/**
 * One sentence saying where the candidates went, or null when nothing needs
 * saying because nothing was dropped.
 */
export function funnelNote(counts, { chain, side, minOpenInterest } = {}) {
  if (!counts || !counts.inWindow) return null;

  const parts = [];
  const add = (n, phrase) => { if (n > 0) parts.push(`${n.toLocaleString()} ${phrase}`); };
  add(counts.inWindow - counts.side, 'on the other side of the market');
  add(counts.side - counts.openInterest, `below the ${minOpenInterest.toLocaleString()} open-interest floor`);
  add(counts.openInterest - counts.bid, 'with no bid');
  add(counts.bid - counts.priced, 'with no price quoted');

  const expiries = `${counts.expirations} expiration${counts.expirations === 1 ? '' : 's'}`;
  const head = `${counts.inWindow.toLocaleString()} contracts list across ${expiries} in this window.`;

  const dropped = counts.inWindow - counts.priced;
  const list = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : parts[0];
  const middle = parts.length
    ? ` Of those, ${list} ${dropped === 1 ? 'is' : 'are'} filtered out, leaving ${counts.priced.toLocaleString()}.`
    : '';

  // The adjusted series are dropped before the screener ever sees the chain, so
  // they never appear in the funnel above — but on some names they are most of
  // what a broker's chain shows, which makes their absence the whole question.
  const adjusted = Number(chain?.adjustedCount) || 0;
  const tail = adjusted
    ? ` ${chain.symbol} also lists ${adjusted.toLocaleString()} adjusted contracts, excluded everywhere in this app: one of them no longer delivers 100 ordinary shares, so none of these numbers would apply to it.`
    : '';

  return `${head}${middle}${tail}`;
}

/** First row of each expiration in an already-ranked list — so, the best of each. */
export function bestPerExpiration(sortedRows) {
  const seen = new Set();
  return sortedRows.filter((row) => {
    if (seen.has(row.expiration)) return false;
    seen.add(row.expiration);
    return true;
  });
}

/** Ranked best first, with contracts that cannot be scored pushed to the end. */
export function sortRows(rows, rankBy = 'expiry') {
  const value = (r) => {
    const v = rankBy === 'now' ? r.returnNowPct : r.returnAtExpiryPct;
    return Number.isFinite(v) ? v : -Infinity;
  };
  // Ties are common at the bottom (everything worthless returns −100%); break
  // them by cost so the cheapest way to be wrong sorts first.
  return [...rows].sort((a, b) => value(b) - value(a) || a.cost - b.cost);
}

/** The x-axis for the return chart: symmetric around zero, wide enough to hold the view. */
export function curveRange(priceChangePct, { minimum = 30 } = {}) {
  const reach = Math.max(minimum, Math.abs(priceChangePct) * 1.6);
  return Math.ceil(reach / 5) * 5;
}

/**
 * Return against underlying move, for the shares and for each contract, merged
 * onto one x-axis so a single chart and a single tooltip can carry them all.
 *
 * The shares are the benchmark the whole page exists to beat: their line is
 * `y = x` by definition, which is what makes the curvature of everything else
 * legible.
 */
export function returnCurves(rows, {
  spot,
  basis = 'expiry',
  ivChangePct = 0,
  rate = RISK_FREE_RATE,
  reach = 40,
  steps = 61,
  // Fewer tree steps than the table uses: this runs once per contract per point,
  // and the difference is invisible at chart resolution.
  treeSteps = 60,
} = {}) {
  if (!(spot > 0) || !rows.length) return [];

  const out = [];
  for (let i = 0; i < steps; i += 1) {
    const movePct = -reach + (2 * reach * i) / (steps - 1);
    const price = spot * (1 + movePct / 100);
    const point = { movePct, shares: movePct };

    rows.forEach((row, index) => {
      let value;
      if (basis === 'now' && row.iv !== null) {
        // Volatility is re-read at every point on the axis, not carried over
        // from the target: a contract's place on the smile changes all the way
        // along, which is most of why these curves bend the way they do.
        const vol = scenarioIV(row, { spot, price, ivChangePct });
        value = americanOptionPrice(price, row.strike, row.dte, vol, rate, row.optionType, treeSteps);
      } else {
        value = intrinsic(price, row.strike, row.optionType);
      }
      point[`c${index}`] = (value / row.entry - 1) * 100;
    });

    out.push(point);
  }

  return out;
}

/** A short human label for a contract, used in tables, legends and tooltips. */
export function contractLabel(row) {
  const [y, m, d] = row.expiration.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const suffix = row.isStandardRoot ? '' : ` ${row.root}`;
  return `$${row.strike} ${row.optionType} · ${d} ${months[Number(m) - 1]} ${y.slice(-2)}${suffix}`;
}

/** The sentence the page leads with, stating what the screen actually found. */
export function screenVerdict(rows, { priceChangePct, spot, basis, ticker }) {
  const best = rows[0];
  if (!best) {
    return {
      tone: 'neutral',
      headline: 'No contract in this expiration range clears the filters. Widen the dates or drop the open-interest floor.',
    };
  }

  const ret = basis === 'now' ? best.returnNowPct : best.returnAtExpiryPct;
  const target = spot * (1 + priceChangePct / 100);
  const direction = priceChangePct >= 0 ? 'rises' : 'falls';

  if (!(ret > 0)) {
    return {
      tone: 'caution',
      headline:
        `Nothing here profits from ${ticker} at $${target.toFixed(2)}. Every contract in range costs more than the move ` +
        'is worth, so this view is better expressed in the shares — or not at all.',
    };
  }

  // Against the *size* of the move, not its sign: a put returning 437% on a 25%
  // fall is 17× the move, not −17×.
  const size = Math.abs(priceChangePct);
  const multiple = size > 0 ? `, roughly ${(ret / size).toFixed(1)}× the move` : '';
  const benchmark = priceChangePct >= 0
    ? `${priceChangePct.toFixed(0)}% for holding the shares`
    : `${size.toFixed(0)}% for shorting them`;

  // Ranking by the "now" valuation can put a wing option on top that is worth
  // nothing at expiry at this very target. That is a real trade and a real
  // number, but it is a trade you have to *close*, and saying so is the
  // difference between a screen and a trap.
  if (basis === 'now' && best.returnAtExpiryPct <= -99) {
    return {
      tone: 'caution',
      headline:
        `If ${ticker} ${direction} ${size.toFixed(0)}% to $${target.toFixed(2)} straight away, the ${contractLabel(best)} ` +
        `at $${best.entry.toFixed(2)} gains the most — ${ret.toFixed(0)}% — but it is worth nothing at that same price by ` +
        'expiry. All of that return is time value you would have to sell before it decays, not a payoff you can hold for. ' +
        'Rank at expiration instead if you intend to hold.',
    };
  }

  return {
    tone: 'positive',
    headline:
      `If ${ticker} ${direction} ${size.toFixed(0)}% to $${target.toFixed(2)}, the best contract in range ` +
      `is the ${contractLabel(best)} at $${best.entry.toFixed(2)} — a ${ret.toFixed(0)}% return against ` +
      `${benchmark}${multiple}. ` +
      `Its delta of ${best.delta === null ? 'n/a' : best.delta.toFixed(2)} is the market's own estimate of the odds it pays at all.`,
  };
}
