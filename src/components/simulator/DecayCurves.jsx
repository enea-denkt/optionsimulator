import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart as LineChartIcon } from 'lucide-react';
import { niceAxis } from '@/lib/chartScale';

// Darkest has the most time left, so the family reads as time draining away.
const TIME_COLOURS = ['#1e3a8a', '#2563eb', '#60a5fa', '#94a3b8'];

const money = (v) => (Number.isFinite(v) ? `$${v.toFixed(2)}` : '—');

/**
 * The textbook picture of an option's value: premium against price, one curve
 * per time to expiry.
 *
 * Drawn twice — solid at the market's volatility, dashed at the benchmark — so
 * the space between the two families is the volatility risk premium seen as a
 * shape. It is widest at the money and with the most time left, and pinches to
 * nothing at expiry where the two curves become the same kinked line, because
 * by then there is no volatility left to disagree about.
 */
export default function DecayCurves({
  rows, series, spot, strike, targetPrice, marketPremium, benchmarkVolPct, ivPct, optionType,
}) {
  // When implied and the benchmark are three points apart the two families of
  // curves sit almost on top of each other, and the gap — the entire subject of
  // the chart — is invisible. Plotting the difference instead makes it legible
  // at any magnitude, which matters most when it is small.
  const [mode, setMode] = useState('premium');
  if (!rows?.length) return null;

  const gap = mode === 'gap';
  const value = (row, key) => (gap ? (row[key] ?? 0) - (row[`${key}fair`] ?? 0) : row[key]);

  let high = 0;
  let low = 0;
  for (const r of rows) {
    for (const s of series) {
      const v = value(r, s.key);
      if (v > high) high = v;
      if (v < low) low = v;
    }
  }
  const { domain, ticks } = niceAxis(Math.min(low, 0), high * 1.05 || 1, { floorAt: Math.min(low, 0) });

  return (
    <Card className="border-slate-200 shadow-xl mb-6">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white pb-8">
        <CardTitle className="text-xl font-semibold text-slate-900 flex items-center gap-2">
          <LineChartIcon className="w-5 h-5" style={{ color: '#A0CBF5' }} />
          What the Premium Is Worth at Each Price, as Time Runs Out
        </CardTitle>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-2xl text-sm text-slate-500">
            {gap
              ? `How much dearer the market's ${ivPct.toFixed(1)}% implied volatility makes this contract than the ${benchmarkVolPct.toFixed(1)}% benchmark does, at each price. Above zero you would be overpaying.`
              : `Solid at the market's ${ivPct.toFixed(1)}% implied volatility, dashed at the ${benchmarkVolPct.toFixed(1)}% benchmark. The space between them is what the volatility premium buys you.`}
          </p>
          <div className="flex shrink-0 rounded-lg border border-slate-200 p-0.5">
            {[
              { id: 'premium', label: 'Premium', hint: 'What the contract is worth at each price' },
              { id: 'gap', label: 'Overpay', hint: 'Just the distance between the two, which is readable however small it gets' },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                title={o.hint}
                onClick={() => setMode(o.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  mode === o.id ? 'text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
                style={mode === o.id ? { backgroundColor: '#2188e6' } : undefined}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={rows} margin={{ top: 20, right: 24, left: 12, bottom: 28 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="price"
              type="number"
              domain={['dataMin', 'dataMax']}
              stroke="#64748b"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `$${v.toFixed(v < 25 ? 1 : 0)}`}
              label={{ value: 'Share price', position: 'insideBottom', offset: -18, style: { fontSize: 12, fill: '#64748b' } }}
            />
            <YAxis
              stroke="#64748b"
              tick={{ fontSize: 11 }}
              width={70}
              domain={domain}
              ticks={ticks}
              tickFormatter={(v) => `$${v.toFixed(2)}`}
              label={{ value: 'Premium per share', angle: -90, position: 'insideLeft', offset: 0, style: { fontSize: 12, fill: '#64748b' } }}
            />
            <Tooltip content={<CurveTooltip series={series} benchmarkVolPct={benchmarkVolPct} gap={gap} />} />
            {gap && <ReferenceLine y={0} stroke="#94a3b8" />}

            <ReferenceLine x={strike} stroke="#cbd5e1" label={{ value: `Strike $${strike}`, position: 'insideTopLeft', style: { fontSize: 11, fill: '#64748b' } }} />
            <ReferenceLine x={spot} stroke="#94a3b8" strokeDasharray="5 5" label={{ value: 'Today', position: 'top', style: { fontSize: 11, fill: '#64748b' } }} />
            {Number.isFinite(targetPrice) && Math.abs(targetPrice - spot) > 0.01 && (
              <ReferenceLine x={targetPrice} stroke="#0f172a" strokeDasharray="4 4" label={{ value: 'Your target', position: 'top', style: { fontSize: 11, fontWeight: 600, fill: '#0f172a' } }} />
            )}

            {!gap && series.map((s, i) => (
              <Line
                key={`${s.key}fair`}
                dataKey={`${s.key}fair`}
                stroke={TIME_COLOURS[i % TIME_COLOURS.length]}
                strokeWidth={1.4}
                strokeDasharray="5 4"
                strokeOpacity={0.8}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
            {series.map((s, i) => (
              <Line
                key={s.key}
                dataKey={gap ? (row) => (row[s.key] ?? 0) - (row[`${s.key}fair`] ?? 0) : s.key}
                stroke={TIME_COLOURS[i % TIME_COLOURS.length]}
                strokeWidth={2.2}
                dot={false}
                isAnimationActive={false}
              />
            ))}

            {/* Where you actually are: today's price, today's premium. */}
            {!gap && marketPremium > 0 && (
              <ReferenceDot
                x={spot}
                y={marketPremium}
                r={5}
                fill="#FF2300"
                stroke="#fff"
                strokeWidth={2}
                isFront
                label={{ value: `You pay ${money(marketPremium)}`, position: 'right', style: { fontSize: 11, fontWeight: 600, fill: '#FF2300' } }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
          {series.map((s, i) => (
            <span key={s.key} className="flex items-center gap-2">
              <svg width="22" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="22" y2="4" stroke={TIME_COLOURS[i % TIME_COLOURS.length]} strokeWidth="2.2" />
              </svg>
              {s.label}
            </span>
          ))}
          {!gap && (
            <span className="flex items-center gap-2 text-slate-500">
              <svg width="22" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="22" y2="4" stroke="#64748b" strokeWidth="1.4" strokeDasharray="5 4" />
              </svg>
              Dashed: the same curve at the benchmark
            </span>
          )}
        </div>

        <p className="mt-4 text-xs italic text-slate-500">
          {gap
            ? `Each curve is one family's distance from the other. It humps near the strike, where volatility has the most to price, and collapses to a flat zero at expiry — by then only intrinsic value is left and the two volatilities agree exactly. The height of the hump is what the ${optionType} charges you for the market being right about volatility rather than the benchmark.`
            : `The red dot is your entry. Above the dashed curve of the same colour, you are paying more than the benchmark says the ${optionType} is worth; below it, less. Watch the two families converge as the curves flatten toward expiry — that convergence is time value being paid out, and it is the only thing an option buyer is ever really long.`}
        </p>
      </CardContent>
    </Card>
  );
}

function CurveTooltip({ active, payload, label, series, benchmarkVolPct, gap }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
      <p className="mb-1 text-sm font-semibold text-slate-900">Share price ${label.toFixed(2)}</p>
      <div className="space-y-0.5">
        {series.map((s, i) => (
          <p key={s.key} className="flex items-center gap-3 text-xs">
            <span className="text-slate-500">{s.label}</span>
            <span className="ml-auto font-semibold" style={{ color: TIME_COLOURS[i % TIME_COLOURS.length] }}>
              {money(gap ? (p[s.key] ?? 0) - (p[`${s.key}fair`] ?? 0) : p[s.key])}
            </span>
            <span className="w-16 text-right text-slate-400">
              {gap || p[`${s.key}fair`] === null ? '' : `vs ${money(p[`${s.key}fair`])}`}
            </span>
          </p>
        ))}
      </div>
      <p className="mt-1.5 border-t border-slate-100 pt-1.5 text-[11px] text-slate-400">
        {gap ? `Overpay against ${benchmarkVolPct.toFixed(1)}%` : `Second column is the same contract at ${benchmarkVolPct.toFixed(1)}%`}
      </p>
    </div>
  );
}
