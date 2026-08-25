import { useState } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Gauge } from 'lucide-react';
import { niceAxis } from '@/lib/chartScale';

const BRAND = '#2188e6';
const FAIR = '#f59e0b';
const DECAY = '#94a3b8';
const PAID = '#0f172a';

const TONE = {
  caution: 'border-amber-200 bg-amber-50 text-amber-900',
  positive: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
};

function formatDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}`;
}

const money = (v) => (Number.isFinite(v) ? `$${v.toFixed(2)}` : '—');

/**
 * The premium's whole future, not one path through it.
 *
 * Shaded bands are where the premium lands if the underlying finishes anywhere
 * inside its own one- and two-standard-deviation cone; the lines are the three
 * paths worth naming. The point of drawing them together is the gap at day
 * zero: what the contract costs, against what the stock's actual movement says
 * it is worth. That gap is the whole of "rich" or "cheap".
 */
export default function PremiumBandsChart({
  rows, verdict, fair, marketPremium, ivPct, realizedVolPct, priceChangePct, ivChangePct, ticker,
}) {
  // A call's two-standard-deviation upside is unbounded: on a 75%-volatility
  // name it reaches six times the premium by expiry and squashes every line
  // that matters into the bottom fifth of the plot. Fitting the axis to the
  // inner band keeps the lines legible and lets the outer one run off the top,
  // which is where the toggle comes in — the whole range is one click away.
  const [fit, setFit] = useState('band1');
  if (!rows?.length) return null;

  const last = rows[rows.length - 1];
  const { domain: yDomain, ticks: yTicks } = axisFor(rows, fit, marketPremium);

  return (
    <Card className="border-slate-200 shadow-xl mb-6">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white pb-8">
        <CardTitle className="text-xl font-semibold text-slate-900 flex items-center gap-2">
          <Gauge className="w-5 h-5" style={{ color: '#A0CBF5' }} />
          Premium Over Time, and Whether It Is Rich or Cheap
        </CardTitle>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-2xl text-sm text-slate-500">
            Where the premium can go between now and expiry, as the underlying disperses and time
            runs out. Shaded areas are the one- and two-standard-deviation ranges for the share price.
          </p>
          <div className="flex shrink-0 rounded-lg border border-slate-200 p-0.5">
            {[
              { id: 'band1', label: 'Fit 1 s.d.', hint: 'Scale the axis to the inner band, so the lines stay readable' },
              { id: 'band2', label: 'Fit 2 s.d.', hint: 'Show the whole outer band, which flattens everything else' },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                title={o.hint}
                onClick={() => setFit(o.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  fit === o.id ? 'text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
                style={fit === o.id ? { backgroundColor: BRAND } : undefined}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        {verdict && (
          <p className={`mb-4 rounded-lg border px-3 py-2 text-sm ${TONE[verdict.tone] || TONE.neutral}`}>
            <strong>{verdict.label}.</strong> {verdict.headline}
          </p>
        )}

        {!verdict && (
          <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            The rich-or-cheap reading needs the stock&apos;s realized volatility, which is computed
            from its price history — so it needs a ticker. In freeform mode the bands and the paths
            are still exact; only the fair-value line is missing.
          </p>
        )}

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Premium today" value={money(marketPremium)} hint="What one share of this contract costs" tone="brand" />
          <Tile
            label="Worth at realized vol"
            value={money(fair)}
            hint={realizedVolPct > 0 ? `Priced at ${realizedVolPct.toFixed(1)}%, the stock's own last 30 days` : 'Needs price history'}
          />
          <Tile
            label="Volatility gap"
            value={realizedVolPct > 0 ? `${ivPct - realizedVolPct > 0 ? '+' : ''}${(ivPct - realizedVolPct).toFixed(1)} pts` : '—'}
            hint={`${ivPct.toFixed(1)}% implied vs realized`}
            tone={realizedVolPct > 0 ? (ivPct - realizedVolPct > 0 ? 'negative' : 'positive') : 'default'}
          />
          <Tile
            label="Your scenario at expiry"
            value={money(last.scenario)}
            hint={`${priceChangePct > 0 ? '+' : ''}${priceChangePct}% price, ${ivChangePct > 0 ? '+' : ''}${ivChangePct}% IV`}
          />
        </div>

        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={rows} margin={{ top: 20, right: 24, left: 12, bottom: 28 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="date"
              stroke="#64748b"
              tick={{ fontSize: 11 }}
              minTickGap={40}
              tickFormatter={formatDate}
              label={{ value: 'Date', position: 'insideBottom', offset: -18, style: { fontSize: 12, fill: '#64748b' } }}
            />
            <YAxis
              stroke="#64748b"
              tick={{ fontSize: 11 }}
              width={70}
              domain={yDomain}
              ticks={yTicks}
              // The outer band is clipped rather than dropped when the axis is
              // fitted to the inner one: it still shades the part of its range
              // that overlaps, so its lower edge stays readable.
              allowDataOverflow
              tickFormatter={(v) => `$${v.toFixed(2)}`}
              label={{ value: 'Premium per share', angle: -90, position: 'insideLeft', offset: 0, style: { fontSize: 12, fill: '#64748b' } }}
            />
            <Tooltip content={<BandTooltip ticker={ticker} />} />

            {/* Areas first so every line draws on top of them. */}
            <Area
              dataKey="band2"
              stroke="none"
              fill={BRAND}
              fillOpacity={0.09}
              isAnimationActive={false}
              activeDot={false}
            />
            <Area
              dataKey="band1"
              stroke="none"
              fill={BRAND}
              fillOpacity={0.16}
              isAnimationActive={false}
              activeDot={false}
            />

            <ReferenceLine
              y={marketPremium}
              stroke={PAID}
              strokeDasharray="2 3"
              label={{ value: `Paid ${money(marketPremium)}`, position: 'insideTopRight', style: { fontSize: 11, fill: PAID } }}
            />

            <Line dataKey="decay" stroke={DECAY} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            {realizedVolPct > 0 && (
              <Line dataKey="fair" stroke={FAIR} strokeWidth={2} strokeDasharray="6 3" dot={false} connectNulls isAnimationActive={false} />
            )}
            <Line dataKey="scenario" stroke={BRAND} strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
          <Swatch colour={BRAND} width={2.5}>Your scenario</Swatch>
          <Swatch colour={DECAY} dashed>Price flat, volatility unchanged — pure time decay</Swatch>
          {realizedVolPct > 0 && <Swatch colour={FAIR} width={2} dashed>Worth at the stock&apos;s realized volatility</Swatch>}
          <span className="flex items-center gap-2">
            <span className="h-3 w-6 rounded-sm" style={{ backgroundColor: BRAND, opacity: 0.16 }} />
            Share price within one standard deviation
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-6 rounded-sm" style={{ backgroundColor: BRAND, opacity: 0.09 }} />
            Within two
          </span>
        </div>

        <p className="mt-4 text-xs italic text-slate-500">
          The band is where the premium sits if the share price ends up anywhere in its own implied
          cone — it is a range of outcomes, not a forecast, and its width comes from today&apos;s
          implied volatility because that is the market&apos;s own statement about how far the stock
          can travel. Pricing inside it follows your volatility view. Rich and cheap are measured
          against realized volatility rather than against the model, because implied volatility is
          worked backwards out of the premium: pricing a contract at its own implied volatility
          returns its own price, always, and compares nothing.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * The top of the y-axis: whichever band the reader chose to fit, and never less
 * than what the lines and the premium paid need, so fitting the inner band can
 * never hide the scenario it is being compared against.
 */
function axisFor(rows, fit, marketPremium) {
  let top = Number.isFinite(marketPremium) ? marketPremium : 0;
  for (const r of rows) {
    for (const v of [r.scenario, r.decay, r.fair, r[fit][1]]) {
      if (Number.isFinite(v) && v > top) top = v;
    }
  }
  return niceAxis(0, top > 0 ? top * 1.05 : 1, { floorAt: 0, targetTicks: 6 });
}

function Tile({ label, value, hint, tone = 'default' }) {
  const colour = tone === 'brand' ? BRAND : tone === 'negative' ? '#FF2300' : tone === 'positive' ? '#1DBC60' : '#0f172a';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold" style={{ color: colour }}>{value}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{hint}</p>
    </div>
  );
}

function Swatch({ colour, width = 1.5, dashed, children }) {
  return (
    <span className="flex items-center gap-2">
      <svg width="22" height="8" aria-hidden="true">
        <line x1="0" y1="4" x2="22" y2="4" stroke={colour} strokeWidth={width} strokeDasharray={dashed ? '5 3' : undefined} />
      </svg>
      {children}
    </span>
  );
}

function BandTooltip({ active, payload, label, ticker }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;

  const row = (name, value, colour) => (
    <p key={name} className="flex items-center gap-3 text-xs">
      <span className="text-slate-500">{name}</span>
      <span className="ml-auto font-semibold" style={{ color: colour || '#0f172a' }}>{value}</span>
    </p>
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
      <p className="mb-1 text-sm font-semibold text-slate-900">
        {formatDate(label)} · {p.remaining} days left
      </p>
      <div className="space-y-0.5">
        {row('Your scenario', money(p.scenario), BRAND)}
        {row(`${ticker || 'Share'} price then`, `$${p.scenarioSpot.toFixed(2)} at ${p.scenarioIV.toFixed(1)}% IV`)}
        {row('Flat price', money(p.decay), DECAY)}
        {p.fair !== null && row('At realized vol', money(p.fair), FAIR)}
      </div>
      <div className="mt-1.5 space-y-0.5 border-t border-slate-100 pt-1.5">
        {row('Within 1 s.d.', `${money(p.band1[0])} – ${money(p.band1[1])}`)}
        {row('Within 2 s.d.', `${money(p.band2[0])} – ${money(p.band2[1])}`)}
      </div>
    </div>
  );
}
