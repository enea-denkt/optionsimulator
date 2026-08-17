import { useMemo } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import InsightCard, { ChartTooltip } from './InsightCard';
import { forecastCone, expectedMove, CONFIDENCE_LEVELS } from '@/lib/optionAnalytics';

const BRAND = '#2188e6';
const RV_COLOUR = '#f59e0b';

function formatDate(iso, span) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Beyond a year the day of the month is noise; inside it, it is the point.
  return span > 400 ? `${months[m - 1]} '${String(y).slice(-2)}` : `${months[m - 1]} ${d}`;
}

export default function PriceForecastChart({
  history,
  spot,
  ivPct,
  rvPct,
  dte,
  expiration,
  confidence,
  onConfidenceChange,
  showRealizedCone,
  onToggleRealizedCone,
}) {
  const level = CONFIDENCE_LEVELS.find((l) => l.id === confidence) || CONFIDENCE_LEVELS[0];

  const { chartData, move, rvMove } = useMemo(() => {
    const cone = forecastCone(spot, ivPct, dte, level.z, { steps: 40 });
    const rvCone = showRealizedCone && rvPct
      ? forecastCone(spot, rvPct, dte, level.z, { steps: 40 })
      : [];
    const rvByDate = new Map(rvCone.map((p) => [p.date, p]));

    const past = history.map((bar) => ({ date: bar.date, close: bar.close }));

    const future = cone.map((point, i) => {
      const rv = rvByDate.get(point.date);
      return {
        date: point.date,
        // Carry the last close onto the first forecast point so the historical
        // line joins the cone instead of ending in mid-air.
        close: i === 0 ? spot : null,
        coneBase: point.lower,
        coneHeight: point.upper - point.lower,
        upper: point.upper,
        lower: point.lower,
        mid: point.mid,
        rvUpper: rv ? rv.upper : null,
        rvLower: rv ? rv.lower : null,
      };
    });

    return {
      chartData: [...past, ...future],
      move: expectedMove(spot, ivPct, dte),
      rvMove: rvPct ? expectedMove(spot, rvPct, dte) : null,
    };
  }, [history, spot, ivPct, rvPct, dte, level.z, showRealizedCone]);

  const span = chartData.length;
  // Falls back to {} when the cone is empty — an expiration dated today produces
  // no forward points, leaving a plain history bar as the last row.
  const last = chartData[chartData.length - 1] || {};

  const verdict = move
    ? `Options are pricing a ${level.label} chance that ${expiration ? 'by ' : ''}${expiration || 'expiry'} the stock sits between ` +
      `$${last.lower.toFixed(2)} and $${last.upper.toFixed(2)} — a range of ` +
      `${(((last.upper - last.lower) / 2 / spot) * 100).toFixed(1)}% either side of today's $${spot.toFixed(2)}.`
    : 'Not enough data to build a forecast range.';

  return (
    <InsightCard
      title="Price history and the range the options market is pricing"
      subtitle="Past closes, then a forward band implied by volatility. The band is a range of outcomes, not a prediction of direction."
      icon={TrendingUp}
      verdict={verdict}
      tone="info"
      footnote={
        `The band assumes prices are lognormal with no drift and that volatility stays at ${ivPct.toFixed(1)}% for the whole horizon. ` +
        'The centre line is today’s price because that is the median of that distribution — it is not a forecast that the price stays flat. ' +
        'The upper edge sits further away in dollars than the lower one, which is what compounding returns look like.'
      }
      action={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {CONFIDENCE_LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => onConfidenceChange(l.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  l.id === confidence ? 'text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
                style={l.id === confidence ? { backgroundColor: BRAND } : undefined}
                title={l.note}
              >
                {l.label}
              </button>
            ))}
          </div>
          {rvPct > 0 && (
            <button
              type="button"
              onClick={onToggleRealizedCone}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                showRealizedCone
                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Compare with actual moves
            </button>
          )}
        </div>
      }
    >
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="date"
            stroke="#64748b"
            tick={{ fontSize: 11 }}
            minTickGap={40}
            tickFormatter={(v) => formatDate(v, span)}
          />
          <YAxis
            stroke="#64748b"
            tick={{ fontSize: 11 }}
            domain={['auto', 'auto']}
            width={62}
            tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0)}`}
            label={{ value: 'Share price', angle: -90, position: 'insideLeft', offset: 4, style: { fontSize: 12, fill: '#64748b' } }}
          />
          <Tooltip content={<PriceTooltip level={level} span={span} />} />

          {/* The cone is drawn as two stacked areas: an invisible plinth up to
              the lower bound, then the band itself. */}
          <Area dataKey="coneBase" stackId="cone" stroke="none" fill="transparent" isAnimationActive={false} />
          <Area
            dataKey="coneHeight"
            stackId="cone"
            stroke="none"
            fill={BRAND}
            fillOpacity={0.14}
            isAnimationActive={false}
          />

          {showRealizedCone && (
            <>
              <Line dataKey="rvUpper" stroke={RV_COLOUR} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              <Line dataKey="rvLower" stroke={RV_COLOUR} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            </>
          )}

          <Line dataKey="mid" stroke={BRAND} strokeWidth={1} strokeDasharray="2 4" dot={false} isAnimationActive={false} />
          <Line dataKey="close" stroke="#0f172a" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          <ReferenceLine y={spot} stroke="#94a3b8" strokeDasharray="5 5" />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600">
        <Swatch colour="#0f172a">Actual price</Swatch>
        <Swatch colour={BRAND} block>Implied {level.label} range</Swatch>
        {showRealizedCone && (
          <Swatch colour={RV_COLOUR} dashed>
            Same range using the last 30 days of actual moves ({rvPct?.toFixed(1)}%)
          </Swatch>
        )}
      </div>

      {rvMove && move && (
        <p className="mt-3 text-xs text-slate-500">
          Options imply ±{move.pct.toFixed(1)}% by expiry; repeating the stock&apos;s recent behaviour would
          give ±{rvMove.pct.toFixed(1)}%.
        </p>
      )}
    </InsightCard>
  );
}

function Swatch({ colour, dashed, block, children }) {
  return (
    <span className="flex items-center gap-2">
      {block ? (
        <span className="h-3 w-6 rounded-sm" style={{ backgroundColor: colour, opacity: 0.25 }} />
      ) : (
        <svg width="24" height="8" aria-hidden="true">
          <line x1="0" y1="4" x2="24" y2="4" stroke={colour} strokeWidth="2.5" strokeDasharray={dashed ? '4 3' : undefined} />
        </svg>
      )}
      {children}
    </span>
  );
}

function PriceTooltip({ active, payload, label, level, span }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const money = (v) => `$${Number(v).toFixed(2)}`;
  const isForecast = point.upper !== undefined && point.upper !== null;

  return (
    <ChartTooltip
      title={formatDate(label, span)}
      rows={[
        point.close != null && { label: 'Close', value: money(point.close), color: '#0f172a' },
        isForecast && { label: `Upper (${level.label})`, value: money(point.upper), color: BRAND },
        isForecast && { label: `Lower (${level.label})`, value: money(point.lower), color: BRAND },
        point.rvUpper != null && { label: 'Upper, actual moves', value: money(point.rvUpper), color: RV_COLOUR },
        point.rvLower != null && { label: 'Lower, actual moves', value: money(point.rvLower), color: RV_COLOUR },
      ]}
    />
  );
}
