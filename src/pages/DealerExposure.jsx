import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { AlertCircle, Loader2, Magnet, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TickerMultiSelect from '@/components/comparison/TickerMultiSelect';
import MetricTile from '@/components/insights/MetricTile';
import InsightCard, { ChartTooltip } from '@/components/insights/InsightCard';
import ExposurePanel from '@/components/exposure/ExposurePanel';
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
  { id: 'gex', label: 'Gamma exposure', short: 'GEX', unit: 'per 1% move in spot' },
  { id: 'vex', label: 'Vanna exposure', short: 'VEX', unit: 'per 1 volatility point' },
  { id: 'oi', label: 'Open interest', short: 'OI', unit: 'contracts' },
];

// Heatseeker shows GEX and VEX side by side for one name, and several names
// side by side for a comparison. Both layouts come from the same panel.
const VIEWS = [
  { id: 'both', label: 'GEX and VEX', metrics: ['gex', 'vex'] },
  { id: 'gex', label: 'GEX only', metrics: ['gex'] },
  { id: 'vex', label: 'VEX only', metrics: ['vex'] },
  { id: 'oi', label: 'Open interest', metrics: ['oi'] },
];

const MAX_TICKERS = 4;

const URL_SPEC = {
  tickers: asString(''),
  view: asEnum(VIEWS.map((v) => v.id), 'both'),
  horizon: { ...asNumber(60), param: 'days' },
  strikeRange: { ...asNumber(15), param: 'range' },
  assumption: { ...asEnum(Object.keys(DEALER_ASSUMPTIONS), 'dealer-long-calls'), param: 'dealers' },
};

const URL_DEFAULTS = {
  tickers: '', view: 'both', horizon: 60, strikeRange: 15, assumption: 'dealer-long-calls',
};

export default function DealerExposure() {
  const [view, setView] = useUrlState(URL_SPEC, URL_DEFAULTS, {
    initial: { tickers: getLastTicker() },
  });
  const { tickers, view: layout, horizon, strikeRange, assumption } = view;
  const set = (patch) => setView((prev) => ({ ...prev, ...patch }));

  const symbols = useMemo(
    () => tickers.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, MAX_TICKERS),
    [tickers],
  );

  const [chains, setChains] = useState({});
  const [pending, setPending] = useState([]);
  const [errors, setErrors] = useState({});
  const inFlight = useRef(new Set());

  const loadSymbols = useCallback(async (wanted, { force = false } = {}) => {
    const missing = wanted.filter((s) => (force || !chains[s]) && !inFlight.current.has(s));
    if (!missing.length) return;

    missing.forEach((s) => inFlight.current.add(s));
    setPending((p) => [...new Set([...p, ...missing])]);

    await Promise.all(missing.map(async (symbol) => {
      try {
        const chain = await fetchOptionChain(symbol, { force });
        setChains((prev) => ({ ...prev, [symbol]: chain }));
        setErrors((prev) => { const n = { ...prev }; delete n[symbol]; return n; });
      } catch (err) {
        setErrors((prev) => ({ ...prev, [symbol]: err.message || 'Could not load' }));
      } finally {
        inFlight.current.delete(symbol);
        setPending((p) => p.filter((s) => s !== symbol));
      }
    }));
  }, [chains]);

  useEffect(() => { loadSymbols(symbols); }, [symbols, loadSymbols]);

  useEffect(() => { if (symbols[0]) setLastTicker(symbols[0]); }, [symbols]);

  // Memoised: it feeds the model useMemo below, and a fresh array each render
  // would recompute every grid on every keystroke.
  const metrics = useMemo(() => VIEWS.find((v) => v.id === layout)?.metrics || ['gex'], [layout]);

  /**
   * One model per ticker. Each carries the panel grids for whichever measures
   * are on show, plus the single-name detail used when only one is selected.
   */
  const models = useMemo(() => symbols.map((symbol) => {
    const chain = chains[symbol];
    if (!chain || !(chain.stockPrice > 0)) return null;

    const spot = chain.stockPrice;
    const expirations = listExpirations(chain)
      .filter((e) => e.dte > 0 && e.dte <= horizon && e.openInterest > 0);
    if (!expirations.length) return null;

    const lo = spot * (1 - strikeRange / 100);
    const hi = spot * (1 + strikeRange / 100);

    const byExpiration = new Map(expirations.map((e) => [e.expiration, e.dte]));
    const contracts = [];
    for (const c of chain.bySymbol.values()) {
      const dte = byExpiration.get(c.expiration);
      if (dte === undefined || c.strike < lo || c.strike > hi) continue;
      contracts.push({ ...c, dte });
    }

    const grids = {};
    for (const metric of metrics) {
      const g = exposureGrid(chain, expirations, { spot, metric, assumption });
      grids[metric] = {
        cells: g.cells.filter((c) => c.strike >= lo && c.strike <= hi),
        strikes: g.strikes.filter((k) => k >= lo && k <= hi),
      };
    }

    const rows = exposureByStrike(contracts, { atSpot: spot, assumption });
    const profile = exposureProfile(contracts, { spot, assumption });
    const flip = gammaFlip(profile);
    const netGex = rows.reduce((s, r) => s + r.gex, 0);

    return {
      symbol, chain, spot, expirations, grids, rows, profile, flip,
      levels: keyLevels(rows, spot),
      netGex,
      netVex: rows.reduce((s, r) => s + r.vex, 0),
      contractCount: contracts.length,
      verdict: regimeVerdict(netGex, spot, flip),
    };
  }).filter(Boolean), [symbols, chains, horizon, strikeRange, metrics, assumption]);

  const single = models.length === 1 ? models[0] : null;
  const loading = pending.length > 0;

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
          whether that hedging fights a move or feeds it. Each cell is a node: the larger its value,
          the harder it pulls on price. The brightest node in a panel is the King.
        </p>
        <p className="mt-3 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Read the assumption before the numbers.</strong> Open interest says how many
          contracts exist, never who is long and who is short. Every gamma-exposure model published
          anywhere fills that gap with a convention — here, that dealers are long calls and short
          puts. When that is wrong for a name, the sign of the whole picture is wrong. It is a
          setting below, not a hidden constant.
        </p>
      </motion.div>

      <Card className="mb-6 border-slate-200 shadow-lg">
        <CardContent className="grid gap-5 p-4 sm:p-6 lg:grid-cols-3">
          <div className="space-y-2 lg:col-span-2">
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

          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700">Panels</Label>
            <Select value={layout} onValueChange={(v) => set({ view: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {VIEWS.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-slate-500">
              {metrics.map((m) => METRICS.find((x) => x.id === m)?.unit).join(' · ')}
            </p>
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
            label="Expirations included" display={`next ${horizon} days`}
            hint="Near-dated contracts carry most of the gamma"
            value={horizon} min={7} max={365} step={1}
            onChange={(v) => set({ horizon: v })}
          />
          <SliderRow
            label="Strike range" display={`±${strikeRange}%`}
            hint="Strikes far from spot carry gamma that rounds to nothing"
            value={strikeRange} min={3} max={40} step={1}
            onChange={(v) => set({ strikeRange: v })}
          />
        </CardContent>
      </Card>

      {!symbols.length && !loading && (
        <Card className="border-dashed border-slate-300 shadow-none">
          <CardContent className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <Search className="h-8 w-8 text-slate-300" />
            <p className="text-base font-semibold text-slate-700">Add a ticker to begin</p>
            <p className="max-w-md text-sm text-slate-500">
              Exposure is most meaningful on names with deep, liquid chains. Add several to compare
              them side by side.
            </p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <p className="mb-4 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading {pending.join(', ')}...
        </p>
      )}

      {Object.entries(errors).map(([symbol, message]) => (
        <p key={symbol} className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>{symbol}</strong>: {message}</span>
        </p>
      ))}

      {/* The panels. Horizontal scroll rather than wrapping, so several names
          stay side by side the way they are meant to be read. */}
      {models.length > 0 && (
        <div className="mb-6 overflow-x-auto pb-2">
          <div className="flex gap-4">
            {models.flatMap((m) => metrics.map((metric) => (
              <ExposurePanel
                key={`${m.symbol}-${metric}`}
                symbol={m.symbol}
                price={m.spot}
                changePercent={m.chain.priceChangePercent}
                metric={METRICS.find((x) => x.id === metric)?.short || metric}
                cells={m.grids[metric].cells}
                strikes={m.grids[metric].strikes}
                expirations={m.expirations}
                spot={m.spot}
              />
            )))}
          </div>
        </div>
      )}

      {models.length > 0 && (
        <p className="mb-6 text-xs italic text-slate-500">
          Colour runs across each panel&apos;s own range, from its most negative value in deep purple
          to its most positive in yellow — so brightness tracks magnitude rather than sign, and the
          nodes that pull hardest stand out. Open interest is end-of-day, so this reads
          yesterday&apos;s positioning against today&apos;s price.
        </p>
      )}

      {/* Single-name detail: the levels and the profile only make sense one
          ticker at a time. */}
      {single && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            <MetricTile label="Share price" value={`$${single.spot.toFixed(2)}`} hint="Delayed quote" tone="brand" />
            <MetricTile
              label="Net gamma exposure" value={formatExposure(single.netGex)}
              hint="Dollars of delta per 1% move"
              tone={single.netGex >= 0 ? 'positive' : 'negative'}
            />
            <MetricTile
              label="Gamma flip"
              value={single.flip ? `$${single.flip.toFixed(2)}` : 'none nearby'}
              hint={single.flip ? `${(((single.flip - single.spot) / single.spot) * 100).toFixed(1)}% from spot` : 'No sign change within ±20%'}
            />
            <MetricTile
              label="Call wall" value={single.levels.callWall ? `$${single.levels.callWall.strike}` : '—'}
              hint="Largest positive gamma above spot"
            />
            <MetricTile
              label="Put wall" value={single.levels.putWall ? `$${single.levels.putWall.strike}` : '—'}
              hint="Largest negative gamma below spot"
            />
          </div>

          {single.verdict && (
            <Card className="border-slate-200 shadow-lg">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-6 sm:p-6">
                <Magnet className="h-8 w-8 shrink-0" style={{ color: single.netGex >= 0 ? BRAND : NEG }} />
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{single.verdict.regime}</p>
                  <p className="mt-1 text-sm text-slate-600">{single.verdict.headline}</p>
                </div>
              </CardContent>
            </Card>
          )}

          <InsightCard
            title="How exposure changes as price moves"
            subtitle="Net gamma recomputed at each hypothetical spot price. Where the line crosses zero is the flip."
            icon={Magnet}
            footnote="Volatility is held at each contract's current level while price is swept. In reality volatility rises as price falls, which tends to put the true flip higher than this curve shows."
          >
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={single.profile} margin={{ top: 28, right: 16, left: 8, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="price" type="number" domain={['dataMin', 'dataMax']}
                  stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(0)}`}
                  label={{ value: 'Hypothetical share price', position: 'insideBottom', offset: -16, style: { fontSize: 12, fill: '#64748b' } }}
                />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} width={64} tickFormatter={formatExposure} />
                <Tooltip content={<ProfileTooltip />} />
                <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={2} />
                <ReferenceLine x={single.spot} stroke="#0f172a" strokeDasharray="5 5" label={{ value: 'Spot', position: 'top', style: { fontSize: 11, fill: '#0f172a' } }} />
                {single.flip && <ReferenceLine x={single.flip} stroke={BRAND} strokeWidth={2} label={{ value: 'Flip', position: 'top', style: { fontSize: 11, fill: BRAND } }} />}
                <Line dataKey="gex" stroke={BRAND} strokeWidth={2.5} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </InsightCard>

          <InsightCard
            title="Net exposure by strike"
            subtitle="Summed across every expiration in the window, at today's spot."
            icon={Magnet}
            footnote="Positive bars are strikes where dealer hedging leans against a move; negative bars are where it runs with it."
          >
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={single.rows} margin={{ top: 28, right: 16, left: 8, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="strike" type="number" domain={['dataMin', 'dataMax']}
                  stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`}
                  label={{ value: 'Strike price', position: 'insideBottom', offset: -16, style: { fontSize: 12, fill: '#64748b' } }}
                />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} width={64} tickFormatter={formatExposure} />
                <Tooltip content={<StrikeTooltip />} />
                <ReferenceLine y={0} stroke="#94a3b8" />
                <ReferenceLine x={single.spot} stroke="#0f172a" strokeDasharray="5 5" label={{ value: 'Spot', position: 'top', style: { fontSize: 11, fill: '#0f172a' } }} />
                <Bar dataKey="gex" isAnimationActive={false}>
                  {single.rows.map((r) => <Cell key={r.strike} fill={r.gex >= 0 ? BRAND : NEG} />)}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </InsightCard>

          <p className="pb-4 text-xs italic text-slate-500">
            Built from {single.contractCount.toLocaleString()} contracts with open interest across{' '}
            {single.expirations.length} expirations. Gamma and vanna are recomputed with
            Black-Scholes at each price rather than read from the feed, since the profile asks what
            exposure would be at prices other than today&apos;s.
          </p>
        </div>
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

function StrikeTooltip({ active, payload, label }) {
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
      ]}
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
