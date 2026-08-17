import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import InsightCard, { ChartTooltip } from './InsightCard';

const CALL = '#1DBC60';
const PUT = '#FF2300';

/**
 * Open interest, or today's volume, per strike.
 *
 * Open interest is accumulated positioning — contracts that exist right now.
 * Volume is what changed hands today. They answer different questions, so the
 * card toggles between them rather than picking one.
 */
export default function OpenInterestChart({ data, spot, ratios, expirationLabel, metric, onMetricChange }) {
  // Controlled from the page so the choice lands in the URL with the rest of the
  // view; falls back to open interest when rendered without a controller.
  const active = metric || 'oi';
  const isOI = active === 'oi';

  const callKey = isOI ? 'callOI' : 'callVolume';
  const putKey = isOI ? 'putOI' : 'putVolume';
  const ratio = isOI ? ratios?.oiRatio : ratios?.volumeRatio;

  const busiest = data.reduce(
    (best, row) => {
      const total = row[callKey] + row[putKey];
      return total > best.total ? { strike: row.strike, total } : best;
    },
    { strike: null, total: 0 },
  );

  const verdict = (() => {
    if (!busiest.strike) return 'Nothing is open at these strikes yet.';
    const side = ratio == null
      ? ''
      : ratio > 1.15
        ? ` Puts outnumber calls ${ratio.toFixed(2)} to 1, so positioning leans defensive.`
        : ratio < 0.85
          ? ` Calls outnumber puts ${(1 / ratio).toFixed(2)} to 1, so positioning leans bullish.`
          : ' Calls and puts are roughly balanced.';
    return `The busiest strike is $${busiest.strike}, holding ${busiest.total.toLocaleString()} ${isOI ? 'open contracts' : 'contracts traded today'}.${side}`;
  })();

  return (
    <InsightCard
      title={isOI ? 'Where positions are held' : 'Where trading happened today'}
      subtitle={`${isOI ? 'Open interest' : 'Volume'} by strike for ${expirationLabel}.`}
      icon={BarChart3}
      verdict={verdict}
      tone="neutral"
      footnote="Open interest counts contracts that exist; volume counts contracts that changed hands today. Neither says which side initiated the trade, so a wall of puts is not proof anyone is bearish — it may be someone selling insurance."
      action={
        <div className="flex rounded-lg border border-slate-200 p-0.5">
          {[
            { id: 'oi', label: 'Open interest' },
            { id: 'volume', label: 'Volume' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onMetricChange?.(opt.id)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                active === opt.id ? 'text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
              style={active === opt.id ? { backgroundColor: '#2188e6' } : undefined}
            >
              {opt.label}
            </button>
          ))}
        </div>
      }
    >
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 28, right: 16, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="strike"
            stroke="#64748b"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `$${v}`}
            minTickGap={16}
            label={{ value: 'Strike price', position: 'insideBottom', offset: -16, style: { fontSize: 12, fill: '#64748b' } }}
          />
          <YAxis
            stroke="#64748b"
            tick={{ fontSize: 11 }}
            width={56}
            tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)}
            label={{ value: 'Contracts', angle: -90, position: 'insideLeft', offset: 4, style: { fontSize: 12, fill: '#64748b' } }}
          />
          <Tooltip cursor={{ fill: '#f1f5f9' }} content={<OITooltip isOI={isOI} spot={spot} />} />
          <ReferenceLine
            x={data.reduce((closest, r) => (Math.abs(r.strike - spot) < Math.abs(closest - spot) ? r.strike : closest), data[0]?.strike ?? spot)}
            stroke="#94a3b8"
            strokeDasharray="5 5"
            label={{ value: 'Today', position: 'top', style: { fontSize: 11, fill: '#64748b' } }}
          />
          <Bar dataKey={callKey} fill={CALL} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          <Bar dataKey={putKey} fill={PUT} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: CALL }} /> Calls
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: PUT }} /> Puts
        </span>
        {ratio != null && (
          <span className="text-slate-500">
            Put/call ratio: <strong className="text-slate-700">{ratio.toFixed(2)}</strong>
          </span>
        )}
      </div>
    </InsightCard>
  );
}

function OITooltip({ active, payload, label, isOI, spot }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const away = spot > 0 ? ((label / spot - 1) * 100).toFixed(1) : null;
  const calls = isOI ? p.callOI : p.callVolume;
  const puts = isOI ? p.putOI : p.putVolume;

  return (
    <ChartTooltip
      title={`Strike $${label}${away ? ` (${away > 0 ? '+' : ''}${away}%)` : ''}`}
      rows={[
        { label: 'Calls', value: calls.toLocaleString(), color: CALL },
        { label: 'Puts', value: puts.toLocaleString(), color: PUT },
        { label: 'Total', value: (calls + puts).toLocaleString() },
      ]}
    />
  );
}
