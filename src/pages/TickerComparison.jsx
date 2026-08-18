import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { AlertCircle, Loader2, RefreshCw, Scale, Smile, CalendarClock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TickerMultiSelect from '@/components/comparison/TickerMultiSelect';
import ComparisonTable from '@/components/comparison/ComparisonTable';
import IVCurveChart, { SERIES_COLOURS } from '@/components/comparison/IVCurveChart';
import InsightCard, { ChartTooltip } from '@/components/insights/InsightCard';
import { fetchOptionChain } from '@/api/marketData';
import {
  MATCH_MODES, METRICS, DEFAULT_DELTA, DEFAULT_MONEYNESS, DEFAULT_TARGET_DTE,
  pickExpiration, pickContract, compareContract, comparisonVerdict, rankingValue,
  matchLimits, furthestExpiry,
} from '@/lib/optionComparison';
import { smileCurve, termCurve, skewSlope, surfaceVerdict } from '@/lib/volatilitySurface';
import { listExpirations } from '@/lib/optionAnalytics';
import { useUrlState, asString, asNumber, asEnum } from '@/lib/useUrlState';
import { getLastTicker, setLastTicker } from '@/lib/tickerMemory';

const BRAND = '#2188e6';
const DEFAULT_TICKERS = 'MSTR,NVDA,AAPL,KO';
const MAX_TICKERS = 6;

const URL_SPEC = {
  tickers: asString(DEFAULT_TICKERS),
  matchMode: { ...asEnum(['moneyness', 'delta'], 'delta'), param: 'match' },
  delta: asNumber(DEFAULT_DELTA),
  moneyness: { ...asNumber(DEFAULT_MONEYNESS), param: 'mny' },
  targetDte: { ...asNumber(DEFAULT_TARGET_DTE), param: 'dte' },
  optionType: { ...asEnum(['call', 'put'], 'call'), param: 'type' },
  metricId: { ...asEnum(METRICS.map((m) => m.id), 'ivPct'), param: 'metric' },
  curveScale: { ...asEnum(['absolute', 'relative'], 'absolute'), param: 'curve' },
};

/**
 * A carried-over ticker leads the list, with the default peers behind it: the
 * point of this page is a comparison, so landing on a single row would be a
 * worse answer than landing on that name measured against others.
 */
function seedTickers() {
  const remembered = getLastTicker();
  if (!remembered) return DEFAULT_TICKERS;
  const peers = DEFAULT_TICKERS.split(',').filter((t) => t !== remembered);
  return [remembered, ...peers].slice(0, 4).join(',');
}

const URL_DEFAULTS = {
  tickers: DEFAULT_TICKERS,
  matchMode: 'delta',
  delta: DEFAULT_DELTA,
  moneyness: DEFAULT_MONEYNESS,
  targetDte: DEFAULT_TARGET_DTE,
  optionType: 'call',
  metricId: 'ivPct',
  curveScale: 'absolute',
};

export default function TickerComparison() {
  const [view, setView] = useUrlState(URL_SPEC, URL_DEFAULTS, {
    initial: { tickers: seedTickers() },
  });
  const { tickers, matchMode, delta, moneyness, targetDte, optionType, metricId, curveScale } = view;
  const set = (patch) => setView((prev) => ({ ...prev, ...patch }));

  const symbols = useMemo(
    () => tickers.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, MAX_TICKERS),
    [tickers],
  );

  const [chains, setChains] = useState({});
  const [pending, setPending] = useState([]);
  const [errors, setErrors] = useState({});
  const [sort, setSort] = useState({ key: 'ivPct', dir: 'desc' });

  // Chains are cached per symbol, so removing and re-adding a ticker is free and
  // only genuinely new symbols hit the network.
  const inFlight = useRef(new Set());

  const loadSymbols = useCallback(async (wanted, { force = false } = {}) => {
    const missing = wanted.filter((s) => (force || !chains[s]) && !inFlight.current.has(s));
    if (!missing.length) return;

    missing.forEach((s) => inFlight.current.add(s));
    setPending((p) => [...new Set([...p, ...missing])]);

    await Promise.all(
      missing.map(async (symbol) => {
        try {
          const chain = await fetchOptionChain(symbol, { force });
          setChains((prev) => ({ ...prev, [symbol]: chain }));
          setErrors((prev) => {
            const next = { ...prev };
            delete next[symbol];
            return next;
          });
        } catch (err) {
          setErrors((prev) => ({ ...prev, [symbol]: err.message || 'Could not load' }));
        } finally {
          inFlight.current.delete(symbol);
          setPending((p) => p.filter((s) => s !== symbol));
        }
      }),
    );
    // `chains` is read only to skip symbols already loaded.
  }, [chains]);

  useEffect(() => {
    loadSymbols(symbols);
  }, [symbols, loadSymbols]);

  // The first ticker is this page's subject, so it is the one the other pages
  // should open on.
  useEffect(() => {
    if (symbols[0]) setLastTicker(symbols[0]);
  }, [symbols]);

  const { rows, unmatched } = useMemo(() => {
    const out = [];
    const missed = [];

    for (const symbol of symbols) {
      const chain = chains[symbol];
      if (!chain) continue;

      const expiration = pickExpiration(chain, targetDte);
      if (!expiration) {
        missed.push({ symbol, reason: 'no expirations with open interest' });
        continue;
      }

      const contract = pickContract(chain, expiration.expiration, optionType, {
        mode: matchMode, moneyness, delta, spot: chain.stockPrice,
      });
      if (!contract) {
        missed.push({
          symbol,
          reason: matchMode === 'delta'
            ? `no quoted ${optionType} near ${delta.toFixed(2)} delta`
            : `no listed strike near ${(moneyness * 100).toFixed(0)}% of its share price`,
        });
        continue;
      }

      out.push(compareContract({
        symbol, chain, expiration: expiration.expiration, dte: expiration.dte, contract, optionType,
      }));
    }

    return { rows: out, unmatched: missed };
  }, [symbols, chains, targetDte, matchMode, moneyness, delta, optionType]);

  // Where each name's ladder and calendar run out, for the slider ticks.
  const coverage = useMemo(() => {
    const moneyness = [];
    const expiry = [];

    for (const symbol of symbols) {
      const chain = chains[symbol];
      if (!chain || !(chain.stockPrice > 0)) continue;

      const exp = pickExpiration(chain, targetDte);
      if (exp) {
        const limits = matchLimits(chain, exp.expiration, optionType, chain.stockPrice);
        if (limits) moneyness.push({ value: limits.maxMoneyness, label: symbol });
      }

      const furthest = furthestExpiry(chain);
      if (furthest) expiry.push({ value: furthest, label: symbol });
    }

    return { moneyness, expiry };
  }, [symbols, chains, targetDte, optionType]);

  /**
   * The volatility surface, sliced two ways: the smile at the chosen expiry, and
   * the term structure at the chosen moneyness. The existing sliders therefore
   * pick which slice is on screen rather than only driving the table.
   */
  const curves = useMemo(() => {
    const normalise = curveScale === 'relative';
    const smile = { call: [], put: [] };
    const term = { call: [], put: [] };

    symbols.forEach((symbol, i) => {
      const chain = chains[symbol];
      if (!chain || !(chain.stockPrice > 0)) return;

      const spot = chain.stockPrice;
      const colour = SERIES_COLOURS[i % SERIES_COLOURS.length];
      const exp = pickExpiration(chain, targetDte);
      const expirations = listExpirations(chain).filter((e) => e.dte > 0 && e.openInterest > 0);

      for (const side of ['call', 'put']) {
        if (exp) {
          smile[side].push({
            symbol, colour,
            points: smileCurve(chain, exp.expiration, side, spot, { from: 0.7, to: 1.3, normalise }),
            skew: skewSlope(chain, exp.expiration, side, spot),
          });
        }
        term[side].push({
          symbol, colour,
          points: termCurve(chain, expirations, side, spot, moneyness, { normalise }),
          skew: null,
        });
      }
    });

    return { smile, term, normalise };
  }, [symbols, chains, targetDte, moneyness, curveScale]);

  const metric = METRICS.find((m) => m.id === metricId) || METRICS[0];
  const matchLabel = matchMode === 'delta'
    ? `${delta.toFixed(2)} delta`
    : `${(moneyness * 100).toFixed(0)}% of spot`;
  const verdict = comparisonVerdict(rows, metricId, matchLabel);

  // Ordered by ranking value so signed move columns sort by distance travelled,
  // while the bars still plot the signed number the reader sees in the table.
  const chartData = [...rows]
    .filter((r) => rankingValue(metric, r) !== null)
    .sort((a, b) => rankingValue(metric, b) - rankingValue(metric, a));

  const loading = pending.length > 0;

  return (
    <div className="px-4 py-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8"
      >
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">Compare Companies</h2>
        <p className="mt-2 max-w-3xl leading-relaxed text-slate-600">
          Which of these names has the expensive options? Each ticker is sampled at the same point on
          its own surface — the same delta, or the same moneyness — and at a similar time to expiry,
          so the prices are actually comparable. Dollar premiums are not: a $9 option on a $95 stock
          and a $9 option on a $300 stock are different trades.
        </p>
      </motion.div>

      {/* Controls */}
      <Card className="mb-6 border-slate-200 shadow-lg">
        <CardContent className="space-y-6 p-4 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700">
                Tickers <span className="font-normal text-slate-400">({symbols.length} of {MAX_TICKERS})</span>
              </Label>
              <TickerMultiSelect
                value={symbols}
                onChange={(next) => set({ tickers: next.join(',') })}
                max={MAX_TICKERS}
                loadingSymbols={pending}
              />
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">Match strikes by</Label>
                  <Select value={matchMode} onValueChange={(v) => set({ matchMode: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.values(MATCH_MODES).map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">{MATCH_MODES[matchMode].blurb}</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">Option type</Label>
                  <Select value={optionType} onValueChange={(v) => set({ optionType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="call">Calls</SelectItem>
                      <SelectItem value="put">Puts</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {matchMode === 'delta' ? (
                <SliderRow
                  label="Delta"
                  value={delta}
                  display={delta.toFixed(2)}
                  hint={
                    delta >= 0.45
                      ? 'Around the money — roughly a coin flip on finishing in the money'
                      : `Out of the money — about a ${(delta * 100).toFixed(0)}% chance of finishing in the money`
                  }
                  min={0.05} max={0.7} step={0.05}
                  onChange={(v) => set({ delta: v })}
                />
              ) : (
                <SliderRow
                  label="Moneyness"
                  value={moneyness}
                  display={`${(moneyness * 100).toFixed(0)}%`}
                  hint={
                    Math.abs(moneyness - 1) < 0.005
                      ? 'At the money — strike at the current share price'
                      : `Strike ${((moneyness - 1) * 100).toFixed(0)}% ${moneyness > 1 ? 'above' : 'below'} the share price`
                  }
                  min={0.8} max={2} step={0.01}
                  onChange={(v) => set({ moneyness: v })}
                  markers={coverage.moneyness}
                />
              )}

              <SliderRow
                label="Time to expiry"
                value={targetDte}
                display={targetDte >= 365 ? `${(targetDte / 365).toFixed(1)} years` : `${targetDte} days`}
                hint="Each name uses its listed expiration closest to this"
                min={7} max={730} step={1}
                onChange={(v) => set({ targetDte: v })}
                markers={coverage.expiry}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="min-w-[220px] flex-1 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-sm font-medium text-slate-700">Rank on</Label>
                {symbols.length > 0 && !loading && (
                  // Sits beside the controls, because the control is what caused
                  // the drop-out and the warnings below can scroll out of view.
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                      unmatched.length
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {rows.length} of {symbols.length} tickers matched
                    {unmatched.length > 0 && ` · ${unmatched.map((u) => u.symbol).join(', ')} dropped`}
                  </span>
                )}
              </div>
              <Select value={metricId} onValueChange={(v) => { set({ metricId: v }); setSort({ key: v, dir: 'desc' }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METRICS.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <button
              type="button"
              onClick={() => loadSymbols(symbols, { force: true })}
              disabled={loading}
              className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <p className="mb-6 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading chains for {pending.join(', ')}...
        </p>
      )}

      {Object.entries(errors).map(([symbol, message]) => (
        <p key={symbol} className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>{symbol}</strong>: {message}</span>
        </p>
      ))}

      {unmatched.map((u) => (
        <p key={u.symbol} className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <strong>{u.symbol}</strong> is not in the comparison — {u.reason}. It is left out rather than
          matched to something further away, which would make the row misleading.
        </p>
      ))}

      {rows.length > 0 && (
        <div className="space-y-6">
          <InsightCard
            title={`Ranked by ${metric.label.toLowerCase()}`}
            subtitle={`${optionType === 'put' ? 'Puts' : 'Calls'} at ${matchLabel}, about ${targetDte} days to expiry.`}
            icon={Scale}
            verdict={verdict?.headline}
            tone="info"
            footnote={metric.hint}
          >
            <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 52)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 56, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={(v) => metric.format(v)} />
                <YAxis
                  type="category"
                  dataKey="symbol"
                  stroke="#64748b"
                  width={64}
                  tick={{ fontSize: 12, fontWeight: 600 }}
                />
                <Tooltip cursor={{ fill: '#f1f5f9' }} content={<CompareTooltip metric={metric} />} />
                <Bar dataKey={metricId} radius={[0, 4, 4, 0]} isAnimationActive={false} label={{
                  position: 'right', fontSize: 11, fill: '#475569',
                  formatter: (v) => metric.format(v),
                }}>
                  {chartData.map((row, i) => (
                    // Dearest and cheapest are tinted; the rest stay brand blue.
                    <Cell key={row.symbol} fill={i === 0 ? '#FF2300' : i === chartData.length - 1 ? '#1DBC60' : BRAND} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </InsightCard>

          <Card className="border-slate-200 shadow-xl">
            <CardContent className="p-4 sm:p-6">
              <p className="mb-3 text-sm text-slate-600">
                Every measure at once. Click a column to sort; the ranked column is highlighted.
              </p>
              <ComparisonTable rows={rows} metricId={metricId} sort={sort} onSortChange={setSort} />
              <p className="mt-4 text-xs italic text-slate-500">
                Quotes are delayed and premiums are the mid of bid and ask. Each name uses its own
                nearest listed expiration and strike, so days to expiry and moneyness will not match
                exactly — the columns show what was actually picked.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* The volatility surface, compared */}
      {symbols.length > 0 && !loading && (
        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Volatility curves</h3>
              <p className="text-sm text-slate-600">
                How each name prices movement away from today&apos;s price, and further out in time.
              </p>
            </div>
            <div className="flex rounded-lg border border-slate-200 p-0.5">
              {[
                { id: 'absolute', label: 'Outright IV' },
                { id: 'relative', label: 'Relative to own ATM' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => set({ curveScale: opt.id })}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    curveScale === opt.id ? 'text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                  style={curveScale === opt.id ? { backgroundColor: BRAND } : undefined}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {curveScale === 'relative' && (
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              Each curve is divided by its own at-the-money volatility, so height no longer reflects
              how volatile the stock is — only the <strong>shape</strong> of what it charges away from
              the money. A steeper curve means that name is paying up for a big move relative to its
              own baseline, which is a different claim from simply being volatile.
            </p>
          )}

          {/* Smile: across moneyness, at the chosen expiry */}
          <div className="grid gap-6 xl:grid-cols-2">
            {['call', 'put'].map((side) => (
              <IVCurveChart
                key={`smile-${side}`}
                title={`${side === 'call' ? 'Calls' : 'Puts'} — volatility by moneyness`}
                subtitle={`The smile at roughly ${targetDte} days. Left of the dashed line is below today's price.`}
                icon={Smile}
                verdict={surfaceVerdict(curves.smile[side], { normalised: curves.normalise, atMoneyness: null })}
                footnote={
                  side === 'call'
                    ? 'A downward slope means the market charges more for strikes below spot than above — the usual equity shape, and the reason "skew" is the word people use rather than "smile".'
                    : 'Puts are quoted on the same moneyness axis as calls, so the two panels can be read against each other. Where they disagree at the same strike, the wider bid-ask is usually the reason.'
                }
                series={curves.smile[side]}
                xKey="moneyness"
                xLabel="Strike ÷ share price"
                xFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                normalised={curves.normalise}
                referenceX={1}
              />
            ))}
          </div>

          {/* Term structure: across expirations, at the chosen moneyness */}
          <div className="grid gap-6 xl:grid-cols-2">
            {['call', 'put'].map((side) => (
              <IVCurveChart
                key={`term-${side}`}
                title={`${side === 'call' ? 'Calls' : 'Puts'} — volatility by expiration`}
                subtitle={`Held at ${(moneyness * 100).toFixed(0)}% of each share price, so the names stay comparable across time.`}
                icon={CalendarClock}
                footnote="Rising with time is the calm default: more time, more that can go wrong. A curve that falls away is pricing a nearer-term event as the bigger risk. The horizontal scale is logarithmic so near-dated expirations are not squeezed into the left edge."
                series={curves.term[side]}
                xKey="dte"
                xLabel="Days to expiration"
                xFormatter={(v) => (v >= 365 ? `${(v / 365).toFixed(1)}y` : `${v}d`)}
                normalised={curves.normalise}
                referenceX={targetDte}
                logX
              />
            ))}
          </div>

          <p className="pb-4 text-xs italic text-slate-500">
            Curves are interpolated between quoted strikes and stop where quoting stops — no
            extrapolation, so a line that ends early means that name has nothing listed further out.
            The moneyness and expiry sliders above choose which slice of the surface is shown.
          </p>
        </div>
      )}

      {!loading && rows.length === 0 && symbols.length > 0 && (
        <Card className="border-slate-200 shadow-lg">
          <CardContent className="p-6 text-sm text-slate-500">
            No ticker has a contract matching these settings. The ticks under the sliders show
            where each one&apos;s listed strikes and expirations run out — pull back inside them, or
            switch to matching by delta.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * A slider that shows where each ticker's data runs out.
 *
 * `markers` are the cliff edges: past one, that name has nothing listed and its
 * row disappears. Showing them on the track means the drop-off is visible before
 * it happens, rather than being discovered by watching a bar vanish.
 */
function SliderRow({ label, value, display, hint, min, max, step, onChange, markers = [] }) {
  const position = (v) => `${Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))}%`;
  const inRange = markers.filter((m) => m.value > min && m.value < max);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-slate-700">{label}</Label>
        <span className="text-sm font-semibold" style={{ color: BRAND }}>{display}</span>
      </div>

      <div className="relative pb-5">
        <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} />

        {inRange.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-full">
            {inRange.map((m) => (
              <span key={m.label} className="absolute top-0" style={{ left: position(m.value) }}>
                {/* The tick sits on the track; the label hangs below it. */}
                <span
                  className="absolute -top-0.5 block h-4 w-px -translate-x-1/2"
                  style={{ backgroundColor: value > m.value ? '#FF2300' : '#94a3b8' }}
                />
                <span
                  className={`absolute top-4 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium ${
                    value > m.value ? 'text-rose-600' : 'text-slate-400'
                  }`}
                >
                  {m.label}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function CompareTooltip({ active, payload, metric }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <ChartTooltip
      title={`${r.symbol} · $${r.strike} ${r.optionType} · ${r.dte}d`}
      rows={[
        { label: metric.label, value: metric.format(r[metric.id]), color: BRAND },
        { label: 'Share price', value: `$${r.spot.toFixed(2)}` },
        { label: 'Premium', value: `$${r.premium.toFixed(2)}` },
        { label: 'Delta', value: r.delta ? Math.abs(r.delta).toFixed(2) : '—' },
        { label: 'Open interest', value: Number(r.openInterest || 0).toLocaleString() },
      ]}
    />
  );
}
