import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Loader2, RefreshCw, Gauge } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TickerSearch from '@/components/simulator/TickerSearch';
import MetricTile from '@/components/insights/MetricTile';
import PriceForecastChart from '@/components/insights/PriceForecastChart';
import VolatilitySmileChart from '@/components/insights/VolatilitySmileChart';
import TermStructureChart from '@/components/insights/TermStructureChart';
import OpenInterestChart from '@/components/insights/OpenInterestChart';
import MaxPainChart from '@/components/insights/MaxPainChart';
import VolatilityEnvironmentChart, { RankMethodNote } from '@/components/insights/VolatilityEnvironmentChart';
import { fetchOptionChain, fetchPriceHistory, formatExpiration } from '@/api/marketData';
import {
  realizedVolSeries, volIndexSeries, rankAndPercentile, rollingRankSeries, trimForChart, RANK_WINDOW,
} from '@/lib/volatilityHistory';
import { useUrlState, asString, asBoolean, asEnum } from '@/lib/useUrlState';
import {
  listExpirations, atmIV, smile, termStructure, riskReversal25, openInterestByStrike,
  putCallRatio, maxPain, realizedVol, expectedMove, volatilityVerdict, termVerdict, skewVerdict,
  CONFIDENCE_LEVELS,
} from '@/lib/optionAnalytics';

const HISTORY_WINDOWS = [
  { id: '3m', label: '3M', days: 63 },
  { id: '6m', label: '6M', days: 126 },
  { id: '1y', label: '1Y', days: 252 },
  { id: '2y', label: '2Y', days: 504 },
  { id: '5y', label: '5Y', days: 1260 },
];

const DEFAULT_TICKER = 'MSTR';

// Everything a reader needs to see the same page, and nothing derived from the
// chain — quotes should be fresh when a shared link is opened later.
const URL_SPEC = {
  ticker: asString(DEFAULT_TICKER),
  expiration: { ...asString(''), param: 'exp' },
  confidence: { ...asEnum(CONFIDENCE_LEVELS.map((l) => l.id), '68'), param: 'ci' },
  historyWindow: { ...asEnum(HISTORY_WINDOWS.map((w) => w.id), '6m'), param: 'window' },
  showRealizedCone: { ...asBoolean(false), param: 'rv' },
  oiMetric: { ...asEnum(['oi', 'volume'], 'oi'), param: 'oi' },
  rankMethod: { ...asEnum(['rank', 'percentile'], 'rank'), param: 'rank' },
};

const URL_DEFAULTS = {
  ticker: DEFAULT_TICKER,
  expiration: '',
  confidence: '68',
  historyWindow: '6m',
  showRealizedCone: false,
  oiMetric: 'oi',
  rankMethod: 'rank',
};

export default function ChainInsights() {
  const [view, setView] = useUrlState(URL_SPEC, URL_DEFAULTS);
  const { ticker, expiration, confidence, historyWindow, showRealizedCone, oiMetric, rankMethod } = view;
  const set = (patch) => setView((prev) => ({ ...prev, ...patch }));

  const [chain, setChain] = useState(null);
  const [history, setHistory] = useState([]);
  const [vixHistory, setVixHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // `keepExpiration` is what makes a shared link land on the right expiry: on a
  // deliberate ticker change the old expiration is meaningless, but on first
  // load it came from the URL and must survive.
  const load = useCallback(async (symbol, { force = false, keepExpiration = null } = {}) => {
    setLoading(true);
    setError(null);
    try {
      // The chain is required; history only powers the price chart and realized
      // volatility, so a failure there degrades the page instead of emptying it.
      const [nextChain, nextHistory, nextVix] = await Promise.all([
        fetchOptionChain(symbol, { force }),
        fetchPriceHistory(symbol, { force }).catch(() => []),
        // VIX is the market-wide implied reading; it is shared across tickers
        // and cached, so this costs nothing after the first load.
        fetchPriceHistory('VIX', { force }).catch(() => []),
      ]);
      setChain(nextChain);
      setHistory(nextHistory);
      setVixHistory(nextVix);

      const expirations = listExpirations(nextChain);
      const requested = keepExpiration && expirations.some((e) => e.expiration === keepExpiration)
        ? keepExpiration
        : null;
      // Otherwise default to the nearest expiration a month or more out: the very
      // front week is dominated by expiring noise and makes every chart spiky.
      const preferred = expirations.find((e) => e.dte >= 25) || expirations[0];
      set({ expiration: requested || (preferred ? preferred.expiration : '') });
    } catch (err) {
      console.error('Error loading chain insights:', err);
      setChain(null);
      setHistory([]);
      setError(err.message || 'Could not load market data');
    } finally {
      setLoading(false);
    }
    // `set` is a stable wrapper around the state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mount only: the ticker and expiration come from the URL when the link was
  // shared, and from the defaults otherwise.
  useEffect(() => {
    load(view.ticker, { keepExpiration: view.expiration || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTicker = (symbol) => {
    set({ ticker: symbol, expiration: '' });
    load(symbol);
  };

  const spot = chain?.stockPrice || 0;
  const expirations = useMemo(() => (chain ? listExpirations(chain) : []), [chain]);
  const selected = expirations.find((e) => e.expiration === expiration) || null;
  const dte = selected?.dte || 0;

  const analytics = useMemo(() => {
    if (!chain || !expiration || !(spot > 0)) return null;

    const iv = atmIV(chain, expiration, spot);
    const ivPct = iv ? iv * 100 : null;
    const rv30 = realizedVol(history, 30);
    const rr = riskReversal25(chain, expiration);
    const term = termStructure(chain, spot);

    return {
      ivPct,
      rv30,
      rr,
      term,
      smile: smile(chain, expiration, spot),
      oi: openInterestByStrike(chain, expiration),
      ratios: putCallRatio(chain, expiration),
      pain: maxPain(chain, expiration),
      move: ivPct ? expectedMove(spot, ivPct, dte) : null,
      volVerdict: volatilityVerdict(ivPct, rv30),
      termVerdict: termVerdict(term),
      skewVerdict: skewVerdict(rr),
    };
  }, [chain, expiration, spot, history, dte]);

  // Volatility environment: the ticker's own realized volatility, and VIX as the
  // market-wide implied reading. Kept separate on purpose — see the note in
  // src/lib/volatilityHistory.js on why per-ticker IV cannot be ranked here.
  const environment = useMemo(() => {
    const build = (series) => {
      if (series.length < RANK_WINDOW / 2) return null;
      const stats = rankAndPercentile(series, series[series.length - 1].value);
      if (!stats) return null;
      return {
        stats,
        series: trimForChart(series, 2),
        rankSeries: trimForChart(rollingRankSeries(series, { method: rankMethod }), 2),
      };
    };

    return {
      realized: build(realizedVolSeries(history, 30)),
      vix: build(volIndexSeries(vixHistory)),
    };
  }, [history, vixHistory, rankMethod]);

  const windowDays = HISTORY_WINDOWS.find((w) => w.id === historyWindow)?.days || 126;
  const visibleHistory = useMemo(() => history.slice(-windowDays), [history, windowDays]);

  const expirationLabel = expiration ? formatExpiration(expiration) : 'this expiration';

  return (
    <div className="px-4 py-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8"
      >
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">Chain Insights</h2>
        <p className="mt-2 max-w-3xl leading-relaxed text-slate-600">
          What the option chain is currently pricing for one stock: how expensive volatility is
          against how the stock has actually moved, the range implied by expiry, and where
          positioning sits. Every chart states its own conclusion above the plot.
        </p>
      </motion.div>

      {/* Controls */}
      <Card className="mb-6 border-slate-200 shadow-lg">
        <CardContent className="grid gap-4 p-4 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700">Ticker</Label>
            <TickerSearch value={ticker} onSelect={handleTicker} />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700">Expiration</Label>
            <Select value={expiration || ''} onValueChange={(value) => set({ expiration: value })} disabled={!expirations.length}>
              <SelectTrigger>
                <SelectValue placeholder="Select expiration" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {expirations.map((e) => (
                  <SelectItem key={e.expiration} value={e.expiration}>
                    {formatExpiration(e.expiration)} · {e.dte}d · {e.openInterest.toLocaleString()} open
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => load(ticker, { force: true })}
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
          Loading chain and price history for {ticker}...
        </p>
      )}

      {error && (
        <p className="mb-6 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {analytics && !loading && (
        <div className="space-y-6">
          {/* Headline numbers */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            <MetricTile
              label="Share price"
              value={`$${spot.toFixed(2)}`}
              hint={chain.quoteTime ? `Delayed quote, ${chain.quoteTime}` : 'Delayed quote'}
              tone="brand"
            />
            <MetricTile
              label="Volatility priced in"
              value={analytics.ivPct ? `${analytics.ivPct.toFixed(1)}%` : '—'}
              hint={`At-the-money implied volatility for ${expirationLabel}`}
            />
            <MetricTile
              label="Volatility actually seen"
              value={analytics.rv30 ? `${analytics.rv30.toFixed(1)}%` : '—'}
              hint="Realized over the last 30 trading days"
            />
            <MetricTile
              label="Implied move by expiry"
              value={analytics.move ? `±${analytics.move.pct.toFixed(1)}%` : '—'}
              hint={analytics.move ? `±$${analytics.move.abs.toFixed(2)}, about 68% likely` : '1 standard deviation'}
            />
            <MetricTile
              label="Put vs call skew"
              value={analytics.rr ? `${analytics.rr.skew > 0 ? '+' : ''}${analytics.rr.skew.toFixed(1)} pts` : '—'}
              hint="How much more puts cost than calls, at 25 delta"
              tone={analytics.rr ? (analytics.rr.skew > 0 ? 'negative' : 'positive') : 'default'}
            />
          </div>

          {/* Are options expensive? */}
          {analytics.volVerdict && (
            <Card className="border-slate-200 shadow-lg">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
                <Gauge className="h-8 w-8 shrink-0" style={{ color: '#A0CBF5' }} />
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{analytics.volVerdict.headline}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Options for {expirationLabel} price {analytics.ivPct.toFixed(1)}% volatility, while the
                    stock actually moved at {analytics.rv30.toFixed(1)}% over the last 30 trading days — a gap of{' '}
                    <strong>{analytics.volVerdict.spread > 0 ? '+' : ''}{analytics.volVerdict.spread.toFixed(1)} points</strong>{' '}
                    ({analytics.volVerdict.ratio.toFixed(2)}× ).{' '}
                    {analytics.volVerdict.spread > 0
                      ? 'Sellers are being paid above what recent moves would justify; buyers need a bigger move than usual to profit.'
                      : 'Buyers are paying less than recent moves would justify, provided the stock keeps moving as it has.'}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Is this a high-premium environment, historically? */}
          {(environment.realized || environment.vix) && (
            <div className="space-y-4">
              <RankMethodNote />
              <div className="grid gap-6 xl:grid-cols-2">
                {environment.realized && (
                  <VolatilityEnvironmentChart
                    symbol={ticker}
                    series={environment.realized.series}
                    rankSeries={environment.realized.rankSeries}
                    stats={environment.realized.stats}
                    method={rankMethod}
                    onMethodChange={(v) => set({ rankMethod: v })}
                    title={`${ticker} volatility versus its own past`}
                    subtitle="30-day realized volatility over two years, with its rolling 52-week ranking."
                    unitLabel="%"
                    currentLabel="Realized volatility"
                    footnote={
                      'This ranks how much the stock has actually moved, not how its options are priced. ' +
                      'Ranking implied volatility per ticker needs a year of daily IV readings, which this ' +
                      'data source does not publish — it serves only today\u2019s. The VIX panel alongside is a ' +
                      'true implied reading, and the market-wide answer to whether premium is rich right now.'
                    }
                  />
                )}
                {environment.vix && (
                  <VolatilityEnvironmentChart
                    symbol="VIX"
                    series={environment.vix.series}
                    rankSeries={environment.vix.rankSeries}
                    stats={environment.vix.stats}
                    method={rankMethod}
                    onMethodChange={(v) => set({ rankMethod: v })}
                    title="Market-wide premium environment"
                    subtitle="VIX over two years, with its rolling 52-week ranking. This is implied volatility, not realized."
                    unitLabel=""
                    currentLabel="VIX"
                    isImplied
                    footnote={
                      'VIX is the implied volatility of 30-day S&P 500 options, so it prices the whole market ' +
                      'rather than this ticker. It is the closest true implied-volatility ranking available from ' +
                      'a keyless feed, and it moves most single-name premium with it.'
                    }
                  />
                )}
              </div>
            </div>
          )}

          {/* Price and forecast */}
          {visibleHistory.length > 5 && analytics.ivPct ? (
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                <span className="mr-auto text-xs font-medium uppercase tracking-wide text-slate-500">
                  History shown
                </span>
                <div className="flex rounded-lg border border-slate-200 p-0.5">
                  {HISTORY_WINDOWS.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => set({ historyWindow: w.id })}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                        historyWindow === w.id ? 'text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                      style={historyWindow === w.id ? { backgroundColor: '#2188e6' } : undefined}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
              <PriceForecastChart
                history={visibleHistory}
                spot={spot}
                ivPct={analytics.ivPct}
                rvPct={analytics.rv30}
                dte={dte}
                expiration={expirationLabel}
                confidence={confidence}
                onConfidenceChange={(value) => set({ confidence: value })}
                showRealizedCone={showRealizedCone}
                onToggleRealizedCone={() => set({ showRealizedCone: !showRealizedCone })}
              />
            </div>
          ) : (
            <Card className="border-slate-200 shadow-lg">
              <CardContent className="p-6 text-sm text-slate-500">
                Price history is unavailable for {ticker}, so the forecast range cannot be drawn. The
                remaining charts are unaffected.
              </CardContent>
            </Card>
          )}

          {/* Volatility structure */}
          <div className="grid gap-6 xl:grid-cols-2">
            <VolatilitySmileChart
              data={analytics.smile}
              spot={spot}
              riskReversal={analytics.rr}
              verdict={analytics.skewVerdict}
              expirationLabel={expirationLabel}
            />
            <TermStructureChart
              data={analytics.term}
              verdict={analytics.termVerdict}
              selectedDte={dte}
              realizedVol={analytics.rv30}
            />
          </div>

          {/* Positioning */}
          <div className="grid gap-6 xl:grid-cols-2">
            <OpenInterestChart
              data={analytics.oi}
              spot={spot}
              ratios={analytics.ratios}
              expirationLabel={expirationLabel}
              metric={oiMetric}
              onMetricChange={(value) => set({ oiMetric: value })}
            />
            <MaxPainChart
              maxPain={analytics.pain}
              spot={spot}
              expirationLabel={expirationLabel}
              dte={dte}
            />
          </div>

          <p className="pb-4 text-xs italic text-slate-500">
            Quotes are delayed and adjusted option series are excluded. Implied volatility comes from
            the exchange&apos;s own calculation; realized volatility, expected moves and max pain are
            computed here from the chain and daily closes.
          </p>
        </div>
      )}
    </div>
  );
}
