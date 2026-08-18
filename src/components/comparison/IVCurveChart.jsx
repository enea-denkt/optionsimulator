import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import InsightCard, { ChartTooltip } from '@/components/insights/InsightCard';

/** One colour per ticker, reused across both panels so a name reads the same. */
export const SERIES_COLOURS = ['#2188e6', '#1DBC60', '#FF2300', '#f59e0b', '#7c3aed', '#0891b2'];

/**
 * Implied volatility curves for several tickers on one axis.
 *
 * The x-axis is moneyness rather than strike, which is the only way two names
 * with different share prices can share a chart. Calls and puts get their own
 * panel rather than being crowded onto one, since six tickers times two sides
 * would be twelve lines.
 */
export default function IVCurveChart({
  title, subtitle, icon, verdict, footnote, action,
  series, xKey, xLabel, xFormatter, normalised, referenceX, logX,
}) {
  const withData = series.filter((s) => s.points.length > 1);

  if (!withData.length) {
    return (
      <InsightCard title={title} subtitle={subtitle} icon={icon}>
        <p className="py-10 text-center text-sm text-slate-500">
          No quoted volatility across this range for the selected tickers.
        </p>
      </InsightCard>
    );
  }

  return (
    <InsightCard
      title={title} subtitle={subtitle} icon={icon}
      verdict={verdict} tone="info" footnote={footnote} action={action}
    >
      <ResponsiveContainer width="100%" height={300}>
        <LineChart margin={{ top: 10, right: 16, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey={xKey}
            type="number"
            domain={['dataMin', 'dataMax']}
            scale={logX ? 'log' : 'auto'}
            allowDuplicatedCategory={false}
            stroke="#64748b"
            tick={{ fontSize: 11 }}
            tickFormatter={xFormatter}
            label={{ value: xLabel, position: 'insideBottom', offset: -16, style: { fontSize: 12, fill: '#64748b' } }}
          />
          <YAxis
            stroke="#64748b"
            tick={{ fontSize: 11 }}
            width={56}
            domain={['auto', 'auto']}
            tickFormatter={(v) => (normalised ? `${v.toFixed(2)}x` : `${v.toFixed(0)}%`)}
            label={{
              value: normalised ? 'IV ÷ own at-the-money' : 'Implied volatility',
              angle: -90, position: 'insideLeft', offset: 4, style: { fontSize: 12, fill: '#64748b' },
            }}
          />
          <Tooltip content={<CurveTooltip normalised={normalised} xFormatter={xFormatter} xLabel={xLabel} />} />

          {/* At-the-money, or the reference point the other slice is taken at */}
          {referenceX !== undefined && referenceX !== null && (
            <ReferenceLine x={referenceX} stroke="#94a3b8" strokeDasharray="5 5" />
          )}
          {normalised && <ReferenceLine y={1} stroke="#cbd5e1" />}

          {withData.map((s) => (
            <Line
              key={s.symbol}
              data={s.points}
              dataKey="iv"
              name={s.symbol}
              stroke={s.colour}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
        {withData.map((s) => (
          <span key={s.symbol} className="flex items-center gap-2">
            <svg width="22" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="22" y2="4" stroke={s.colour} strokeWidth="2.5" />
            </svg>
            <span className="font-medium">{s.symbol}</span>
            {s.skew !== null && s.skew !== undefined && (
              <span className="text-slate-400">skew {s.skew > 0 ? '+' : ''}{s.skew.toFixed(1)}</span>
            )}
          </span>
        ))}
      </div>
    </InsightCard>
  );
}

function CurveTooltip({ active, payload, label, normalised, xFormatter, xLabel }) {
  if (!active || !payload?.length) return null;
  return (
    <ChartTooltip
      title={`${xLabel}: ${xFormatter(label)}`}
      rows={payload.map((p) => ({
        label: p.name,
        value: normalised ? `${p.value.toFixed(2)}x` : `${p.value.toFixed(1)}%`,
        color: p.stroke,
      }))}
    />
  );
}
