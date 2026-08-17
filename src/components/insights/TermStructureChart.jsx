import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { CalendarClock } from 'lucide-react';
import InsightCard, { ChartTooltip } from './InsightCard';
import { formatExpiration } from '@/api/marketData';

const BRAND = '#2188e6';

/**
 * ATM implied volatility by expiration.
 *
 * The shape is the message: rising is the calm default, falling means the market
 * is pricing a nearer-term event as the bigger risk.
 */
export default function TermStructureChart({ data, verdict, selectedDte, realizedVol }) {
  return (
    <InsightCard
      title="Term structure — is the risk soon, or later?"
      subtitle="At-the-money implied volatility for each expiration, nearest first."
      icon={CalendarClock}
      verdict={verdict?.headline}
      tone={verdict?.shape === 'backwardation' ? 'caution' : 'neutral'}
      footnote="Each point is the volatility priced into options expiring on that date, read at today’s share price. A dip or spike at one expiry usually marks a scheduled event such as earnings."
    >
      {data.length > 1 ? (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data} margin={{ top: 10, right: 16, left: 8, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="dte"
                type="number"
                scale="log"
                domain={['dataMin', 'dataMax']}
                stroke="#64748b"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => (v >= 365 ? `${(v / 365).toFixed(1)}y` : `${v}d`)}
                label={{ value: 'Days until expiration', position: 'insideBottom', offset: -16, style: { fontSize: 12, fill: '#64748b' } }}
              />
              <YAxis
                stroke="#64748b"
                tick={{ fontSize: 11 }}
                width={52}
                domain={['auto', 'auto']}
                tickFormatter={(v) => `${v.toFixed(0)}%`}
                label={{ value: 'Implied volatility', angle: -90, position: 'insideLeft', offset: 4, style: { fontSize: 12, fill: '#64748b' } }}
              />
              <Tooltip content={<TermTooltip />} />

              {realizedVol > 0 && (
                <ReferenceLine
                  y={realizedVol}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  label={{ value: `Actual, last 30d: ${realizedVol.toFixed(0)}%`, position: 'insideTopRight', style: { fontSize: 11, fill: '#b45309' } }}
                />
              )}
              {selectedDte > 0 && <ReferenceLine x={selectedDte} stroke="#cbd5e1" strokeDasharray="5 5" />}

              <Line
                dataKey="atmIVPct"
                stroke={BRAND}
                strokeWidth={2.5}
                dot={{ r: 3, fill: BRAND, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-3 text-xs text-slate-500">
            The horizontal scale is logarithmic, so the near-dated expirations — where most trading
            happens — are not squeezed into the left edge by a single long-dated LEAP.
          </p>
        </>
      ) : (
        <p className="py-10 text-center text-sm text-slate-500">
          Not enough expirations quoted to draw a term structure.
        </p>
      )}
    </InsightCard>
  );
}

function TermTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <ChartTooltip
      title={formatExpiration(p.expiration)}
      rows={[
        { label: 'Days out', value: `${p.dte}` },
        { label: 'Implied volatility', value: `${p.atmIVPct.toFixed(1)}%`, color: BRAND },
      ]}
    />
  );
}
