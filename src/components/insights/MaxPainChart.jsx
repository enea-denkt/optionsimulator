import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Target } from 'lucide-react';
import InsightCard, { ChartTooltip } from './InsightCard';

const BRAND = '#2188e6';

function money(v) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

/**
 * The total payout option writers would owe at each possible settlement price.
 *
 * Presented as the curve rather than as the single minimum, because the curve is
 * the honest object: it shows how shallow or sharp the minimum is, and a shallow
 * one carries no information at all.
 */
export default function MaxPainChart({ maxPain, spot, expirationLabel, dte }) {
  if (!maxPain) {
    return (
      <InsightCard title="Max pain" subtitle="No open interest at this expiration." icon={Target}>
        <p className="py-10 text-center text-sm text-slate-500">
          Nothing is open at these strikes, so there is no payout curve to draw.
        </p>
      </InsightCard>
    );
  }

  const distance = spot > 0 ? ((maxPain.strike / spot - 1) * 100) : 0;
  const payouts = maxPain.curve.map((c) => c.payout);
  const worst = Math.max(...payouts);
  // How deep the minimum is relative to the worst case. A shallow dip means the
  // "pull" story has nothing behind it.
  const depth = worst > 0 ? 1 - maxPain.payoutAtMin / worst : 0;

  const verdict =
    `If ${expirationLabel} settled at $${maxPain.strike}, option writers would pay out ` +
    `${money(maxPain.payoutAtMin)} — less than at any other strike. That is ` +
    `${Math.abs(distance).toFixed(1)}% ${distance >= 0 ? 'above' : 'below'} today's $${spot.toFixed(2)}.`;

  return (
    <InsightCard
      title="Max pain — where expiry would cost option holders most"
      subtitle={`Total payout owed on all open contracts at each settlement price, for ${expirationLabel}.`}
      icon={Target}
      verdict={verdict}
      tone="neutral"
      footnote={
        'Treat this as a map of positioning, not a forecast. The evidence that price gets pulled toward max pain is weak, ' +
        'and what does exist is concentrated in the final days before expiry, when hedging flows are largest. ' +
        `This expiry is ${dte} days out.`
      }
    >
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={maxPain.curve} margin={{ top: 10, right: 16, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="strike"
            type="number"
            domain={['dataMin', 'dataMax']}
            stroke="#64748b"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `$${v}`}
            label={{ value: 'Settlement price', position: 'insideBottom', offset: -16, style: { fontSize: 12, fill: '#64748b' } }}
          />
          <YAxis
            stroke="#64748b"
            tick={{ fontSize: 11 }}
            width={56}
            tickFormatter={money}
            label={{ value: 'Total payout', angle: -90, position: 'insideLeft', offset: 4, style: { fontSize: 12, fill: '#64748b' } }}
          />
          <Tooltip content={<PainTooltip />} />

          <ReferenceLine
            x={maxPain.strike}
            stroke={BRAND}
            strokeWidth={2}
            label={{ value: `Max pain $${maxPain.strike}`, position: 'top', style: { fontSize: 11, fill: BRAND } }}
          />
          <ReferenceLine
            x={spot}
            stroke="#94a3b8"
            strokeDasharray="5 5"
            label={{ value: 'Today', position: 'insideTopLeft', style: { fontSize: 11, fill: '#64748b' } }}
          />

          <Area
            dataKey="payout"
            stroke={BRAND}
            strokeWidth={2}
            fill={BRAND}
            fillOpacity={0.12}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      <p className="mt-3 text-xs text-slate-500">
        The minimum sits {(depth * 100).toFixed(0)}% below the worst-case payout of {money(worst)}
        {depth < 0.25
          ? ' — a shallow dip, so the strike carries little meaning here.'
          : ', a clear low across the strike range.'}{' '}
        Based on {maxPain.totalOI.toLocaleString()} open contracts.
      </p>
    </InsightCard>
  );
}

function PainTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <ChartTooltip
      title={`Settles at $${label}`}
      rows={[
        { label: 'Owed to call holders', value: money(p.callPayout), color: '#1DBC60' },
        { label: 'Owed to put holders', value: money(p.putPayout), color: '#FF2300' },
        { label: 'Total', value: money(p.payout), color: BRAND },
      ]}
    />
  );
}
