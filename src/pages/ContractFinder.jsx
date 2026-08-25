import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Loader2, RefreshCw, Search, Target } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import TickerSearch from '@/components/simulator/TickerSearch';
import MetricTile from '@/components/insights/MetricTile';
import ResultsTable from '@/components/screener/ResultsTable';
import ReturnCurveChart from '@/components/screener/ReturnCurveChart';
import { fetchOptionChain } from '@/api/marketData';
import { listExpirations } from '@/lib/optionAnalytics';
import {
  screenContracts, returnCurves, curveRange, screenVerdict,
  LIQUIDITY_FILTERS, RANK_BASES, VARIETY_MODES, bestPerExpiration, funnelNote,
} from '@/lib/contractScreener';
import { useUrlState, asString, asNumber, asEnum } from '@/lib/useUrlState';
import { getLastTicker, setLastTicker } from '@/lib/tickerMemory';

const BRAND = '#2188e6';
const TOP_N = 20;

const SIDES = [
  { id: 'both', label: 'Both' },
  { id: 'call', label: 'Calls' },
  { id: 'put', label: 'Puts' },
];

const URL_SPEC = {
  ticker: asString(''),
  minDte: { ...asNumber(20), param: 'from' },
  maxDte: { ...asNumber(180), param: 'to' },
  priceChange: { ...asNumber(15), param: 'move' },
  ivChange: { ...asNumber(0), param: 'iv' },
  side: { ...asEnum(SIDES.map((s) => s.id), 'both'), param: 'side' },
  liquidity: { ...asEnum(LIQUIDITY_FILTERS.map((f) => f.id), 'some'), param: 'oi' },
  basis: { ...asEnum(RANK_BASES.map((b) => b.id), 'expiry'), param: 'rank' },
  variety: { ...asEnum(VARIETY_MODES.map((v) => v.id), 'all'), param: 'show' },
  plotted: { ...asNumber(5), param: 'top' },
};

const URL_DEFAULTS = {
  ticker: '',
  minDte: 20,
  maxDte: 180,
  priceChange: 15,
  ivChange: 0,
  side: 'both',
  liquidity: 'some',
  basis: 'expiry',
  variety: 'all',
  plotted: 5,
};

/**
 * Given a view, which contract expresses it best?
 *
 * The inputs are a price target and an implied-volatility view; the output is
 * every listed contract in an expiration window, ranked by what it returns if
 * the view comes true. See src/lib/contractScreener.js for what is and is not
 * being maximised — in particular, why probability is shown but not weighted.
 */
export default function ContractFinder() {
  const [view, setView] = useUrlState(URL_SPEC, URL_DEFAULTS, {
    initial: { ticker: getLastTicker() },
  });
  const { ticker, priceChange, ivChange, side, liquidity, basis, variety } = view;
  const set = (patch) => setView((prev) => ({ ...prev, ...patch }));

  // A hand-edited URL can carry anything the codec accepts as a number, so the
  // ranges are clamped here rather than trusted into a slice or a slider.
  const minDte = Math.max(0, Math.min(view.minDte, view.maxDte));
  const maxDte = Math.max(view.minDte, view.maxDte);
  const plotted = Math.max(1, Math.min(TOP_N, Math.round(view.plotted)));

  const [chain, setChain] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (symbol, { force = false } = {}) => {
    setLoading(true);
    setError(null);
    try {
      setChain(await fetchOptionChain(symbol, { force }));
    } catch (err) {
      console.error('Error loading chain for the contract finder:', err);
      setChain(null);
      setError(err.message || 'Could not load market data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view.ticker) load(view.ticker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ticker) setLastTicker(ticker);
  }, [ticker]);

  const spot = chain?.stockPrice || 0;
  const target = spot * (1 + priceChange / 100);

  // How far out the chain actually goes, so the slider cannot ask for dates that
  // do not exist. LEAPS run past 700 days on the big names and stop at 60 on the
  // small ones — a fixed maximum would be wrong for both.
  const dteLimit = useMemo(() => {
    const expirations = chain ? listExpirations(chain) : [];
    return expirations.length ? expirations[expirations.length - 1].dte : 365;
  }, [chain]);

  const minOpenInterest = LIQUIDITY_FILTERS.find((f) => f.id === liquidity)?.minOpenInterest ?? 0;

  const screen = useMemo(() => {
    if (!chain) return { rows: [], counts: null };
    return screenContracts(chain, {
      priceChangePct: priceChange,
      ivChangePct: ivChange,
      minDte,
      maxDte,
      side,
      minOpenInterest,
      rankBy: basis,
    });
  }, [chain, priceChange, ivChange, minDte, maxDte, side, minOpenInterest, basis]);

  const ranked = screen.rows;
  const funnel = useMemo(
    () => funnelNote(screen.counts, { chain, minOpenInterest }),
    [screen.counts, chain, minOpenInterest],
  );

  // Collapsing to one row per expiry happens after ranking, so the "contracts
  // screened" count keeps meaning how many were actually priced.
  const pool = useMemo(
    () => (variety === 'expiry' ? bestPerExpiration(ranked) : ranked),
    [ranked, variety],
  );

  const top = useMemo(() => pool.slice(0, TOP_N), [pool]);

  // The other end of the same ranking, worst first. Sliced from TOP_N rather
  // than from the end, so a short list cannot show the same contract in both
  // tables and imply it is somehow both the best and the worst.
  const bottom = useMemo(
    () => pool.slice(Math.max(TOP_N, pool.length - TOP_N)).reverse(),
    [pool],
  );
  const reach = curveRange(priceChange);

  const curves = useMemo(
    () => returnCurves(top.slice(0, plotted), {
      spot, basis, reach, ivChangePct: ivChange, markAt: priceChange,
    }),
    [top, plotted, spot, basis, reach, ivChange, priceChange],
  );

  const verdict = useMemo(
    () => screenVerdict(top, { priceChangePct: priceChange, spot, basis, ticker }),
    [top, priceChange, spot, basis, ticker],
  );

  const expirationsInRange = useMemo(() => {
    if (!chain) return 0;
    return listExpirations(chain).filter((e) => e.dte >= minDte && e.dte <= maxDte).length;
  }, [chain, minDte, maxDte]);

  const toneClass = {
    positive: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    caution: 'border-amber-200 bg-amber-50 text-amber-900',
    neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  }[verdict.tone];

  return (
    <div className="px-4 py-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8"
      >
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">Contract Finder</h2>
        <p className="mt-2 max-w-3xl leading-relaxed text-slate-600">
          Say where you think the stock is going and by when. This prices every listed contract in
          that window against your view and ranks them by what they return, so the choice of strike
          and expiry follows from the view instead of from habit.
        </p>
      </motion.div>

      {/* Controls */}
      <Card className="mb-6 border-slate-200 shadow-lg">
        <CardContent className="grid gap-6 p-4 sm:p-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700">Ticker</Label>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <TickerSearch value={ticker} onSelect={(symbol) => { set({ ticker: symbol }); load(symbol); }} />
                </div>
                <button
                  type="button"
                  onClick={() => load(ticker, { force: true })}
                  disabled={loading || !ticker}
                  className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>

            {/* The expiration window: two thumbs on one track, because the pair
                is a single decision about how much time to buy. */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-slate-700">Expirations to search</Label>
                <span className="text-sm font-semibold" style={{ color: BRAND }}>
                  {minDte}–{maxDte} days
                </span>
              </div>
              <Slider
                value={[Math.min(minDte, dteLimit), Math.min(maxDte, dteLimit)]}
                min={0}
                max={dteLimit}
                step={5}
                minStepsBetweenThumbs={1}
                onValueChange={([lo, hi]) => set({ minDte: lo, maxDte: hi })}
              />
              <p className="text-xs text-slate-500">
                {chain
                  ? `${expirationsInRange} expiration${expirationsInRange === 1 ? '' : 's'} in range, out of ${listExpirations(chain).length} listed. The chain runs to ${dteLimit} days.`
                  : 'Pick a ticker to see how far its chain runs.'}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <SliderRow
              label="Where you think the price goes"
              value={priceChange}
              display={`${priceChange > 0 ? '+' : ''}${priceChange}%`}
              hint={
                spot > 0
                  ? `From $${spot.toFixed(2)} to $${target.toFixed(2)} by expiry`
                  : 'The move you expect in the underlying, by expiry'
              }
              min={-60} max={100} step={1}
              onChange={(v) => set({ priceChange: v })}
            />

            <SliderRow
              label="Where you think implied volatility goes"
              value={ivChange}
              display={`${ivChange > 0 ? '+' : ''}${ivChange}%`}
              hint={
                basis === 'now'
                  ? 'Applied to each contract’s own implied volatility when repricing it'
                  : 'Only affects the “if it happens now” column — at expiry there is no time value left to reprice'
              }
              min={-50} max={100} step={5}
              onChange={(v) => set({ ivChange: v })}
            />

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Choice label="Side" options={SIDES} value={side} onChange={(v) => set({ side: v })} />
              <Choice
                label="Open interest"
                options={LIQUIDITY_FILTERS}
                value={liquidity}
                onChange={(v) => set({ liquidity: v })}
              />
              <Choice label="Rank by" options={RANK_BASES} value={basis} onChange={(v) => set({ basis: v })} />
              <Choice label="Show" options={VARIETY_MODES} value={variety} onChange={(v) => set({ variety: v })} />
            </div>
          </div>
        </CardContent>
      </Card>

      {!ticker && !loading && (
        <Card className="border-dashed border-slate-300 shadow-none">
          <CardContent className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <Search className="h-8 w-8 text-slate-300" />
            <p className="text-base font-semibold text-slate-700">Pick a ticker to begin</p>
            <p className="max-w-md text-sm text-slate-500">
              Whatever you choose here carries over to the simulator, so the winning contract can be
              modelled in full on the next page.
            </p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <p className="mb-6 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading the chain for {ticker}...
        </p>
      )}

      {error && (
        <p className="mb-6 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {chain && !loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <MetricTile
              label="Share price"
              value={`$${spot.toFixed(2)}`}
              hint={chain.quoteTime ? `Delayed quote, ${chain.quoteTime}` : 'Delayed quote'}
              tone="brand"
            />
            <MetricTile
              label="Your target"
              value={`$${target.toFixed(2)}`}
              hint={`${priceChange > 0 ? '+' : ''}${priceChange}% from here`}
            />
            <MetricTile
              label="Contracts screened"
              value={ranked.length.toLocaleString()}
              hint={
                screen.counts && screen.counts.inWindow > ranked.length
                  ? `Of ${screen.counts.inWindow.toLocaleString()} listed in ${minDte}–${maxDte} days`
                  : `In ${minDte}–${maxDte} days, ${minOpenInterest ? `${minOpenInterest}+ open interest` : 'any open interest'}`
              }
            />
            <MetricTile
              label="Best return"
              value={
                top.length
                  ? `${(basis === 'now' ? top[0].returnNowPct : top[0].returnAtExpiryPct).toFixed(0)}%`
                  : '—'
              }
              hint={
                top.length
                  ? `At $${target.toFixed(2)} exactly — ${RANK_BASES.find((b) => b.id === basis)?.blurb.toLowerCase()}`
                  : RANK_BASES.find((b) => b.id === basis)?.blurb
              }
              tone={top.length && (basis === 'now' ? top[0].returnNowPct : top[0].returnAtExpiryPct) > 0 ? 'positive' : 'default'}
            />
          </div>

          <Card className="border-slate-200 shadow-lg">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-6 sm:p-6">
              <Target className="h-8 w-8 shrink-0" style={{ color: '#A0CBF5' }} />
              <div className="min-w-0 space-y-2">
                <p className={`rounded-lg border px-3 py-2 text-sm ${toneClass}`}>
                  {verdict.headline}
                </p>
                {funnel && <p className="text-xs text-slate-500">{funnel}</p>}
              </div>
            </CardContent>
          </Card>

          {top.length > 0 && (
            <>
              <ReturnCurveChart
                data={curves}
                rows={top}
                spot={spot}
                expectedMovePct={priceChange}
                basis={basis}
                count={Math.min(plotted, top.length)}
                maxCount={Math.min(TOP_N, top.length)}
                onCountChange={(v) => set({ plotted: v })}
              />

              {/* Both ends of one ranking, side by side: the contrast is the
                  point, so they share a row rather than stacking. */}
              <div className={`grid gap-6 ${bottom.length ? 'xl:grid-cols-2' : ''}`}>
                <div className="min-w-0">
                  <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Best {top.length} of {pool.length.toLocaleString()}
                  </h3>
                  <p className="mb-3 text-xs text-slate-500">
                    The most return per dollar of premium if the view comes true.
                  </p>
                  <ResultsTable
                    rows={top}
                    spot={spot}
                    basis={basis}
                    plotted={Math.min(plotted, top.length)}
                    compact={bottom.length > 0}
                    footnote={`Priced off the ask, so the cost is what opening the position would actually take. Shares at $${spot.toFixed(2)}. Hover a row for its bid, ask, breakeven and open interest.`}
                  />
                </div>

                {bottom.length > 0 && (
                  <div className="min-w-0">
                    <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
                      Worst {bottom.length} of {pool.length.toLocaleString()}
                    </h3>
                    <p className="mb-3 text-xs text-slate-500">
                      The same view, expressed as badly as this chain allows — worst first.
                    </p>
                    <ResultsTable
                      rows={bottom}
                      spot={spot}
                      basis={basis}
                      startRank={pool.length}
                      descending
                      compact
                      footnote={
                        'These are ranked by the same measure as the table beside them, from the bottom. Where a ' +
                        'whole block returns −100% the order within it is by cost, so the last row is the most ' +
                        'expensive way this chain offers to be wrong.'
                      }
                    />
                  </div>
                )}
              </div>
            </>
          )}

          <p className="pb-4 text-xs italic text-slate-500">
            Quotes are delayed and adjusted option series are excluded. Returns assume one contract
            bought at the ask and held; they ignore commissions, assignment and the possibility that
            a wide spread means the quoted ask is not a price anyone will fill.
          </p>
        </div>
      )}
    </div>
  );
}

function SliderRow({ label, value, display, hint, min, max, step, onChange }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-slate-700">{label}</Label>
        <span className="text-sm font-semibold" style={{ color: BRAND }}>{display}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} />
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function Choice({ label, options, value, onChange }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-slate-500">{label}</Label>
      <div className="flex rounded-lg border border-slate-200 p-0.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            title={o.blurb}
            className={`flex-1 truncate rounded px-2 py-1 text-xs font-medium transition-colors ${
              value === o.id ? 'text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
            style={value === o.id ? { backgroundColor: BRAND } : undefined}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
