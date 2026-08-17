import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Smile } from 'lucide-react';
import InsightCard, { ChartTooltip } from './InsightCard';

const BRAND = '#2188e6';
const CALL = '#1DBC60';
const PUT = '#FF2300';

/**
 * IV by strike for one expiration.
 *
 * The headline curve is the out-of-the-money composite — puts below spot, calls
 * above — because that is where the liquidity is. Call and put curves are drawn
 * faintly behind it so the reader can see they agree where they overlap.
 */
export default function VolatilitySmileChart({ data, spot, riskReversal, verdict, expirationLabel }) {
  const hasData = data.some((d) => d.otmIV !== null);

  return (
    <InsightCard
      title="Volatility smile — what the market charges by strike"
      subtitle={`Implied volatility across strikes for ${expirationLabel}. Higher means a pricier option for that strike.`}
      icon={Smile}
      verdict={verdict?.headline}
      tone={verdict?.tone === 'downside' ? 'caution' : 'neutral'}
      footnote="A flat line would mean every strike is priced off the same volatility, as textbook Black-Scholes assumes. Real chains curve, because the market charges more for the tails than a normal distribution implies."
    >
      {hasData ? (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data} margin={{ top: 10, right: 16, left: 8, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="strike"
                type="number"
                domain={['dataMin', 'dataMax']}
                stroke="#64748b"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `$${v}`}
                label={{ value: 'Strike price', position: 'insideBottom', offset: -16, style: { fontSize: 12, fill: '#64748b' } }}
              />
              <YAxis
                stroke="#64748b"
                tick={{ fontSize: 11 }}
                width={52}
                tickFormatter={(v) => `${v.toFixed(0)}%`}
                label={{ value: 'Implied volatility', angle: -90, position: 'insideLeft', offset: 4, style: { fontSize: 12, fill: '#64748b' } }}
              />
              <Tooltip content={<SmileTooltip spot={spot} />} />

              <ReferenceLine
                x={spot}
                stroke="#94a3b8"
                strokeDasharray="5 5"
                label={{ value: 'Today', position: 'top', style: { fontSize: 11, fill: '#64748b' } }}
              />
              {riskReversal && (
                <>
                  <ReferenceLine x={riskReversal.putStrike} stroke="#e2e8f0" />
                  <ReferenceLine x={riskReversal.callStrike} stroke="#e2e8f0" />
                </>
              )}

              <Line dataKey="callIV" stroke={CALL} strokeWidth={1} strokeOpacity={0.45} dot={false} connectNulls isAnimationActive={false} />
              <Line dataKey="putIV" stroke={PUT} strokeWidth={1} strokeOpacity={0.45} dot={false} connectNulls isAnimationActive={false} />
              <Line dataKey="otmIV" stroke={BRAND} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
            <Legend colour={BRAND} width={2.5}>Out-of-the-money options (the curve traders quote)</Legend>
            <Legend colour={CALL}>Calls</Legend>
            <Legend colour={PUT}>Puts</Legend>
          </div>

          {riskReversal && (
            <p className="mt-3 text-xs text-slate-500">
              Measured at 25 delta: the ${riskReversal.putStrike} put prices{' '}
              {riskReversal.putIV.toFixed(1)}% volatility against {riskReversal.callIV.toFixed(1)}% for the
              ${riskReversal.callStrike} call.
            </p>
          )}
        </>
      ) : (
        <Empty />
      )}
    </InsightCard>
  );
}

function Legend({ colour, width = 1.5, children }) {
  return (
    <span className="flex items-center gap-2">
      <svg width="22" height="8" aria-hidden="true">
        <line x1="0" y1="4" x2="22" y2="4" stroke={colour} strokeWidth={width} />
      </svg>
      {children}
    </span>
  );
}

function Empty() {
  return (
    <p className="py-10 text-center text-sm text-slate-500">
      No implied volatility quoted for this expiration.
    </p>
  );
}

function SmileTooltip({ active, payload, label, spot }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const pct = (v) => (v == null ? '—' : `${v.toFixed(1)}%`);
  const away = spot > 0 ? ((label / spot - 1) * 100).toFixed(1) : null;

  return (
    <ChartTooltip
      title={`Strike $${label}${away ? ` (${away > 0 ? '+' : ''}${away}% from today)` : ''}`}
      rows={[
        { label: 'Call IV', value: pct(p.callIV), color: CALL },
        { label: 'Put IV', value: pct(p.putIV), color: PUT },
        { label: 'Open interest', value: (p.callOI + p.putOI).toLocaleString() },
      ]}
    />
  );
}
