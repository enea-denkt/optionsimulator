import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3 } from 'lucide-react';

const PAID = '#FF2300';
const BAR = '#94a3b8';
const BAR_ABOVE = '#2188e6';

/**
 * The volatility being paid, against every volatility the stock has actually
 * delivered.
 *
 * The sharpest form of "is this expensive" and the smallest chart on the page.
 * "Implied is five points above realized" needs interpreting; "you are paying a
 * level this stock has exceeded on 22% of the last two years" does not — and
 * that percentage is roughly how often buying here would have been justified by
 * what the stock went on to do.
 */
export default function VolDistribution({ dist, ivPct, ticker, window = 30 }) {
  if (!dist) return null;

  const { buckets, aboveShare, observations, median } = dist;
  const dear = aboveShare < 25;

  return (
    <Card className="border-slate-200 shadow-xl mb-6">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white pb-8">
        <CardTitle className="text-xl font-semibold text-slate-900 flex items-center gap-2">
          <BarChart3 className="w-5 h-5" style={{ color: '#A0CBF5' }} />
          The Volatility You Are Paying, Against What {ticker || 'the Stock'} Delivers
        </CardTitle>
        <p className="mt-1 text-sm text-slate-500">
          Every {window}-day realized volatility over the last two years, as a histogram, with the
          implied volatility of this contract marked.
        </p>
      </CardHeader>

      <CardContent className="p-6">
        <p
          className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
            dear ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'
          }`}
        >
          You are paying <strong>{ivPct.toFixed(1)}%</strong>.{' '}
          {ticker || 'The stock'} has actually moved faster than that on{' '}
          <strong>{aboveShare.toFixed(0)}%</strong> of the last {observations.toLocaleString()} trading
          days — its median {window}-day volatility is {median.toFixed(1)}%.{' '}
          {dear
            ? 'Buying at this level needs an unusually fast stretch just to break even on volatility.'
            : 'That is a level this stock reaches often enough for the price to be defensible.'}
        </p>

        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={buckets} margin={{ top: 20, right: 20, left: 8, bottom: 28 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="mid"
              type="number"
              domain={['dataMin', 'dataMax']}
              stroke="#64748b"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `${v.toFixed(0)}%`}
              label={{ value: `${window}-day realized volatility`, position: 'insideBottom', offset: -18, style: { fontSize: 12, fill: '#64748b' } }}
            />
            <YAxis
              stroke="#64748b"
              tick={{ fontSize: 11 }}
              width={48}
              label={{ value: 'Days', angle: -90, position: 'insideLeft', offset: 4, style: { fontSize: 12, fill: '#64748b' } }}
            />
            <Tooltip content={<DistTooltip ivPct={ivPct} />} />

            <Bar dataKey="count" isAnimationActive={false}>
              {buckets.map((b) => (
                // Bars past what you are paying are the days that would have
                // justified it, so they get the colour that says so.
                <Cell key={b.from} fill={b.mid > ivPct ? BAR_ABOVE : BAR} />
              ))}
            </Bar>

            <ReferenceLine
              x={ivPct}
              stroke={PAID}
              strokeWidth={2}
              label={{ value: `You pay ${ivPct.toFixed(1)}%`, position: 'top', style: { fontSize: 11, fontWeight: 600, fill: PAID } }}
            />
          </BarChart>
        </ResponsiveContainer>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
          <span className="flex items-center gap-2">
            <span className="h-3 w-4 rounded-sm" style={{ backgroundColor: BAR_ABOVE }} />
            Days the stock moved faster than you are paying for
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-4 rounded-sm" style={{ backgroundColor: BAR }} />
            Days it moved slower
          </span>
        </div>

        <p className="mt-4 text-xs italic text-slate-500">
          Realized volatility is measured from daily closes over rolling {window}-day windows, so
          neighbouring days share most of their data and the shape is smoother than the count of
          observations suggests. It is a record of what this stock has done, not a forecast — a name
          that has just changed character will sit in the wrong half of its own history for a while.
        </p>
      </CardContent>
    </Card>
  );
}

function DistTooltip({ active, payload, ivPct }) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
      <p className="text-sm font-semibold text-slate-900">
        {b.from.toFixed(1)}% – {b.to.toFixed(1)}%
      </p>
      <p className="mt-1 text-xs text-slate-600">
        {b.count.toLocaleString()} day{b.count === 1 ? '' : 's'} · {b.mid > ivPct ? 'faster' : 'slower'} than
        the {ivPct.toFixed(1)}% you pay
      </p>
    </div>
  );
}
