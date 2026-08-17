import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { AlertCircle, Loader2, RefreshCw, Magnet, Search, Grid3x3 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TickerSearch from '@/components/simulator/TickerSearch';
import MetricTile from '@/components/insights/MetricTile';
import InsightCard, { ChartTooltip } from '@/components/insights/InsightCard';
import ExposureHeatmap from '@/components/exposure/ExposureHeatmap';
import { fetchOptionChain } from '@/api/marketData';
import { listExpirations } from '@/lib/optionAnalytics';
import {
  exposureByStrike, exposureProfile, gammaFlip, keyLevels, exposureGrid,
  regimeVerdict, formatExposure, DEALER_ASSUMPTIONS,
} from '@/lib/gammaExposure';
import { useUrlState, asString, asNumber, asEnum } from '@/lib/useUrlState';
import { getLastTicker, setLastTicker } from '@/lib/tickerMemory';

const BRAND = '#2188e6';
const NEG = '#FF2300';

const METRICS = [
  { id: 'gex', label: 'Gamma exposure', unit: 'per 1% move in spot' },
  { id: 'vex', label: 'Vanna exposure', unit: 'per 1 volatility point' },
  { id: 'oi', label: 'Open interest', unit: 'contracts' },
];

const URL_SPEC = {
  ticker: asString(''),
  metric: asEnum(METRICS.map((m) => m.id), 'gex'),
  horizon: { ...asNumber(60), param: 'days' },
  strikeRange: { ...asNumber(15), param: 'range' },
  assumption: { ...asEnum(Object.keys(DEALER_ASSUMPTIONS), 'dealer-long-calls'), param: 'dealers' },
};

const URL_DEFAULTS = {
  ticker: '', metric: 'gex', horizon: 60, strikeRange: 15, assumption: 'dealer-long-calls',
};

export default function DealerExposure() {
  const [view, setView] = useUrlState(URL_SPEC, URL_DEFAULTS, { initial: { ticker: getLastTicker() } });
  const { ticker, metric, horizon, strikeRange, assumption } = view;
  const set = (patch) => setView((prev) => ({ ...prev, ...patch }));

  const [chain, setChain] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (symbol, { force = false } = {}) => {
    setLoading(true);
    setError(null);
    try {
      setChain(await fetchOptionChain(symbol, { force }));
    } catch (err) {
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

  const handleTicker = (symbol) => {
    set({ ticker: symbol });
    load(symbol);
  };

  const spot = chain?.stockPrice || 0;

  const model = useMemo(() => {
    if (!chain || !(spot > 0)) return null;

    const expirations = listExpirations(chain).filter((e) => e.dte > 0 && e.dte <= horizon && e.openInterest > 0);
    if (!expirations.length) return null;

    // Strikes far from spot carry gamma that rounds to nothing, and including
    // them makes both the profile and the heatmap unreadable.
    const lo = spot * (1 - strikeRange / 100);
    const hi = spot * (1 + strikeRange / 100);

    const contracts = [];
    const byExpiration = new Map(expirations.map((e) => [e.expiration, e.dte]));
    for (const c of chain.bySymbol.values()) {
      const dte = byExpiration.get(c.expiration);
      if (dte === undefined) continue;
      if (c.strike < lo || c.strike > hi) continue;
      contracts.push({ ...c, dte });
    }

    const rows = exposureByStrike(contracts, { atSpot: spot, assumption });
    const profile = exposureProfile(contracts, { spot, assumption });
    const flip = gammaFlip(profile);
    const levels = keyLevels(rows, spot);
    const grid = exposureGrid(chain, expirations, { spot, metric, assumption });

    // The grid is built off the whole chain, so trim it to the same window.
    const cells = grid.cells.filter((c) => c.strike >= lo && c.strike <= hi);
    const strikes = grid.strikes.filter((s) => s >= lo && s <= hi);

    const netGex = rows.reduce((s, r) => s + r.gex, 0);
    const netVex = rows.reduce((s, r) => s + r.vex, 0);

    return {
      expirations, rows, profile, flip, levels, cells, strikes, netGex, netVex,
      contractCount: contracts.length,
      verdict: regimeVerdict(netGex, spot, flip),
    };
  }, [chain, spot, horizon, strikeRange, metric, assumption]);

  const activeMetric = METRICS.find((m) => m.id === metric);

  return (
    <div className="px-4 py-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8"
      >
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">Dealer Exposure</h2>
        <p className="mt-2 max-w-3xl leading-relaxed text-slate-600">
          Market makers who sell options hedge in the underlying, and the sign of their gamma decides
          whether that hedging fights a move or feeds it. This maps where the pressure sits, and the
          price at which the regime flips.
        </p>
        <p className="mt-3 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Read the assumption before the numbers.</strong> Open interest says how many
          contracts exist, never who is long and who is short. Every gamma-exposure model published
          anywhere fills that gap with a convention — here, that dealers are long calls and short
          puts. When that is wrong for a name, the sign of the whole picture is wrong. It is a
          setting below, not a hidden constant.
        </p>
      </motion.div>

      {/* Controls */}
      <Card className="mb-6 border-slate-200 shadow-lg">
        <CardContent className="grid gap-5 p-4 sm:p-6 lg:grid-cols-3">
          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700">Ticker</Label>
            <TickerSearch value={ticker} onSelect={handleTicker} />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700">Show</Label>
            <Select value={metric} onValueChange={(v) => set({ metric: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METRICS.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">Measured {activeMetric.unit}</p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700">Who holds the other side</Label>
            <Select value={assumption} onValueChange={(v) => set({ assumption: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(DEALER_ASSUMPTIONS).map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">{DEALER_ASSUMPTIONS[assumption].blurb}</p>
          </div>

          <SliderRow
            label="Expirations included"
            display={`next ${horizon} days`}
            hint="Near-dated contracts carry most of the gamma; a longer window adds context and dilutes it"
            value={horizon} min={7} max={365} step={1}
            onChange={(v) => set({ horizon: v })}
          />
          <SliderRow
            label="Strike range"
            display={`±${strikeRange}%`}
            hint="Strikes far from spot carry gamma that rounds to nothing"
            value={strikeRange} min={5} max={40} step={1}
            onChange={(v) => set({ strikeRange: v })}
          />
          <div className="flex items-end">
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
        </CardContent>
      </Card>

      {!ticker && !loading && (
        <Card className="border-dashed border-slate-300 shadow-none">
          <CardContent className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <Search className="h-8 w-8 text-slate-300" />
            <p className="text-base font-semibold text-slate-700">Pick a ticker to begin</p>
            <p className="max-w-md text-sm text-slate-500">
              Exposure is most meaningful on names with deep, liquid option chains — index ETFs and
              large caps.
            </p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <p className="mb-6 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the chain for {ticker}...
        </p>
      )}

      {error && (
        <p className="mb-6 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {model && !loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            <MetricTile label="Share price" value={`$${spot.toFixed(2)}`} hint="Delayed quote" tone="brand" />
            <MetricTile
              label="Net gamma exposure"
              value={formatExposure(model.netGex)}
              hint="Dollars of delta dealers must trade per 1% move"
              tone={model.netGex >= 0 ? 'positive' : 'negative'}
            />
            <MetricTile
              label="Gamma flip"
              value={model.flip ? `$${model.flip.toFixed(2)}` : 'none nearby'}
              hint={model.flip ? `${(((model.flip - spot) / spot) * 100).toFixed(1)}% from spot` : 'No sign change within ±20%'}
            />
            <MetricTile
              label="Call wall"
              value={model.levels.callWall ? `$${model.levels.callWall.strike}` : '—'}
              hint="Largest positive gamma above spot"
            />
            <MetricTile
              label="Put wall"
              value={model.levels.putWall ? `$${model.levels.putWall.strike}` : '—'}
              hint="Largest negative gamma below spot"
            />
          </div>

          {model.verdict && (
            <Card className="border-slate-200 shadow-lg">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-6 sm:p-6">
                <Magnet className="h-8 w-8 shrink-0" style={{ color: model.netGex >= 0 ? BRAND : NEG }} />
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{model.verdict.regime}</p>
                  <p className="mt-1 text-sm text-slate-600">{model.verdict.headline}</p>
                </div>
              </CardContent>
            </Card>
          )}

          <InsightCard
            title="Where the hedging pressure sits"
            subtitle={`${activeMetric.label} by strike and expiration, ${activeMetric.unit}. ${model.expirations.length} expirations within ${horizon} days.`}
            icon={Grid3x3}
            verdict={
              model.levels.callWall && model.levels.putWall
                ? `The heaviest positive gamma sits at $${model.levels.callWall.strike} and the heaviest negative at $${model.levels.putWall.strike}. In a positive-gamma regime those act as magnets; in a negative one, breaking through them tends to accelerate the move instead.`
                : 'Not enough concentrated open interest to identify walls on either side.'
            }
            tone="info"
            footnote="Each cell is evaluated at today's spot, so this is where pressure sits now rather than under a hypothetical move. Cell shading scales with the square root of magnitude, because one or two strikes otherwise dominate everything."
          >
            <ExposureHeatmap
              cells={model.cells}
              strikes={model.strikes}
              expirations={model.expirations}
              spot={spot}
              metric={metric}
              keyLevels={model.levels}
            />
          </InsightCard>

          <InsightCard
            title="Net exposure by strike"
            subtitle="Summed across every expiration in the window, at today's spot."
            icon={Magnet}
            footnote="Positive bars are strikes where dealer hedging leans against a move; negative bars are where it runs with it."
          >
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={model.rows} margin={{ top: 10, right: 16, left: 8, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="strike" type="number" domain={['dataMin', 'dataMax']}
                  stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`}
                  label={{ value: 'Strike price', position: 'insideBottom', offset: -16, style: { fontSize: 12, fill: '#64748b' } }}
                />
                <YAxis
                  stroke="#64748b" tick={{ fontSize: 11 }} width={64} tickFormatter={formatExposure}
                  label={{ value: activeMetric.label, angle: -90, position: 'insideLeft', offset: 4, style: { fontSize: 12, fill: '#64748b' } }}
                />
                <Tooltip content={<StrikeTooltip metric={metric} />} />
                <ReferenceLine y={0} stroke="#94a3b8" />
                <ReferenceLine x={spot} stroke="#0f172a" strokeDasharray="5 5" label={{ value: 'Spot', position: 'top', style: { fontSize: 11, fill: '#0f172a' } }} />
                {model.flip && (
                  <ReferenceLine x={model.flip} stroke={BRAND} strokeWidth={2} label={{ value: 'Flip', position: 'top', style: { fontSize: 11, fill: BRAND } }} />
                )}
                <Bar dataKey={metric === 'oi' ? 'oi' : metric} isAnimationActive={false}>
                  {model.rows.map((r) => (
                    <Cell key={r.strike} fill={(metric === 'oi' ? r.oi : r[metric]) >= 0 ? BRAND : NEG} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </InsightCard>

          <InsightCard
            title="How exposure changes as price moves"
            subtitle="Net gamma recomputed at each hypothetical spot price. Where the line crosses zero is the flip."
            icon={Magnet}
            footnote="Volatility is held at each contract's current level while price is swept. In reality volatility rises as price falls, which tends to put the true flip higher than this curve shows."
          >
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={model.profile} margin={{ top: 20, right: 16, left: 8, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="price" type="number" domain={['dataMin', 'dataMax']}
                  stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(0)}`}
                  label={{ value: 'Hypothetical share price', position: 'insideBottom', offset: -16, style: { fontSize: 12, fill: '#64748b' } }}
                />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} width={64} tickFormatter={formatExposure} />
                <Tooltip content={<ProfileTooltip />} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={2} />
                <ReferenceLine x={spot} stroke="#0f172a" strokeDasharray="5 5" label={{ value: 'Spot', position: 'top', style: { fontSize: 11, fill: '#0f172a' } }} />
                {model.flip && <ReferenceLine x={model.flip} stroke={BRAND} strokeWidth={2} label={{ value: 'Flip', position: 'top', style: { fontSize: 11, fill: BRAND } }} />}
                <Line dataKey="gex" stroke={BRAND} strokeWidth={2.5} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </InsightCard>

          <p className="pb-4 text-xs italic text-slate-500">
            Built from {model.contractCount.toLocaleString()} contracts with open interest across{' '}
            {model.expirations.length} expirations. Gamma and vanna are recomputed with Black-Scholes
            at each price rather than read from the feed, since the profile asks what exposure would
            be at prices other than today&apos;s. Quotes are delayed and open interest is
            end-of-day, so this describes yesterday&apos;s positioning against today&apos;s price.
          </p>
        </div>
      )}

      {chain && !model && !loading && (
        <Card className="border-slate-200 shadow-lg">
          <CardContent className="p-6 text-sm text-slate-500">
            No expirations with open interest inside {horizon} days. Try widening the window.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SliderRow({ label, display, hint, value, min, max, step, onChange }) {
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

function StrikeTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <ChartTooltip
      title={`Strike $${label}`}
      rows={[
        { label: 'Gamma exposure', value: formatExposure(r.gex), color: r.gex >= 0 ? BRAND : NEG },
        { label: 'Vanna exposure', value: formatExposure(r.vex) },
        { label: 'Open interest', value: r.oi.toLocaleString() },
        { label: 'Calls / puts', value: `${r.callOI.toLocaleString()} / ${r.putOI.toLocaleString()}` },
      ].filter((row) => metric !== 'oi' || row.label !== 'Vanna exposure')}
    />
  );
}

function ProfileTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <ChartTooltip
      title={`If price were $${p.price.toFixed(2)}`}
      rows={[
        { label: 'Net gamma exposure', value: formatExposure(p.gex), color: p.gex >= 0 ? BRAND : NEG },
        { label: 'Net vanna exposure', value: formatExposure(p.vex) },
      ]}
    />
  );
}
