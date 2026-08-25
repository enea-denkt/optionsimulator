import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Gauge, Info } from 'lucide-react';
import InsightCard, { ChartTooltip } from './InsightCard';
import MetricTile from './MetricTile';
import { RANK_METHODS, rankVerdict } from '@/lib/volatilityHistory';

const BRAND = '#2188e6';
const RANK_COLOUR = '#7c3aed';
const RV_COLOUR = '#f59e0b';

function formatDate(iso) {
  const [y, m] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} '${String(y).slice(-2)}`;
}

/**
 * Where today's volatility sits against the last year, and how it got here.
 *
 * Two series, deliberately kept apart rather than blended: the ticker's own
 * *realized* volatility, and VIX as the market-wide *implied* reading. See the
 * header note in src/lib/volatilityHistory.js for why per-ticker implied
 * volatility cannot be ranked from this data source.
 */
export default function VolatilityEnvironmentChart({
  symbol,
  series,        // [{ date, value }] the level being ranked
  rankSeries,    // [{ date, value }] the rolling rank
  stats,         // rankAndPercentile output
  method,
  onMethodChange,
  title,
  subtitle,
  unitLabel,
  currentLabel,
  footnote,
  isImplied,
  rangeControl,
}) {
  if (!stats || series.length < 30) {
    return (
      <InsightCard title={title} subtitle={subtitle} icon={Gauge}>
        <p className="py-10 text-center text-sm text-slate-500">
          Not enough history to rank {symbol} yet.
        </p>
      </InsightCard>
    );
  }

  const levelColour = isImplied ? BRAND : RV_COLOUR;
  const shown = method === 'percentile' ? stats.percentile : stats.rank;
  const verdict = rankVerdict(shown, {
    subject: isImplied ? 'Market-wide implied volatility' : `${symbol} realized volatility`,
    method,
  });

  // Merge level and rank onto one date axis so a single tooltip explains both.
  const rankByDate = new Map(rankSeries.map((p) => [p.date, p.value]));
  const data = series.map((p) => ({ date: p.date, level: p.value, rank: rankByDate.get(p.date) ?? null }));

  return (
    <InsightCard
      title={title}
      subtitle={subtitle}
      icon={Gauge}
      verdict={verdict?.headline}
      tone={verdict?.tone}
      footnote={footnote}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {rangeControl}
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {Object.values(RANK_METHODS).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onMethodChange(m.id)}
                title={m.blurb}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  method === m.id ? 'text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
                style={method === m.id ? { backgroundColor: BRAND } : undefined}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile
          label={currentLabel}
          value={`${stats.current.toFixed(1)}${unitLabel}`}
          hint="Latest reading"
          tone="brand"
        />
        <MetricTile
          label={method === 'percentile' ? '52-week percentile' : '52-week rank'}
          value={shown.toFixed(0)}
          hint={RANK_METHODS[method].blurb}
          tone={shown >= 75 ? 'negative' : shown <= 25 ? 'positive' : 'default'}
        />
        <MetricTile label="52-week low" value={`${stats.low.toFixed(1)}${unitLabel}`} hint="Cheapest in the window" />
        <MetricTile label="52-week high" value={`${stats.high.toFixed(1)}${unitLabel}`} hint="Dearest in the window" />
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 10, right: 8, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="date"
            stroke="#64748b"
            tick={{ fontSize: 11 }}
            minTickGap={48}
            tickFormatter={formatDate}
          />
          <YAxis
            yAxisId="level"
            stroke={levelColour}
            tick={{ fontSize: 11 }}
            width={52}
            tickFormatter={(v) => `${v.toFixed(0)}${unitLabel}`}
            label={{ value: currentLabel, angle: -90, position: 'insideLeft', offset: 4, style: { fontSize: 11, fill: '#64748b' } }}
          />
          <YAxis
            yAxisId="rank"
            orientation="right"
            domain={[0, 100]}
            stroke={RANK_COLOUR}
            tick={{ fontSize: 11 }}
            width={44}
            tickFormatter={(v) => `${v}`}
            label={{ value: 'Rank', angle: 90, position: 'insideRight', offset: 8, style: { fontSize: 11, fill: '#64748b' } }}
          />
          <Tooltip content={<EnvTooltip unitLabel={unitLabel} currentLabel={currentLabel} method={method} colour={levelColour} />} />

          {/* The bands that make a rank readable at a glance. */}
          <ReferenceLine yAxisId="rank" y={75} stroke="#fca5a5" strokeDasharray="4 4" />
          <ReferenceLine yAxisId="rank" y={25} stroke="#86efac" strokeDasharray="4 4" />

          <Area
            yAxisId="level"
            dataKey="level"
            stroke={levelColour}
            strokeWidth={2}
            fill={levelColour}
            fillOpacity={0.1}
            isAnimationActive={false}
          />
          <Line
            yAxisId="rank"
            dataKey="rank"
            stroke={RANK_COLOUR}
            strokeWidth={1.5}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
        <span className="flex items-center gap-2">
          <span className="h-3 w-6 rounded-sm" style={{ backgroundColor: levelColour, opacity: 0.35 }} />
          {currentLabel} (left axis)
        </span>
        <span className="flex items-center gap-2">
          <svg width="22" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="22" y2="4" stroke={RANK_COLOUR} strokeWidth="2" />
          </svg>
          Rolling 52-week {method} (right axis)
        </span>
        <span className="text-slate-400">Dashed lines mark 25 and 75</span>
      </div>
    </InsightCard>
  );
}

/** Explains the rank/percentile distinction where the reader meets it. */
export function RankMethodNote() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <span>
        <strong>Rank</strong> measures where today sits between the 52-week low and high, so a single
        spike a year ago holds every later reading down until it rolls out of the window.{' '}
        <strong>Percentile</strong> is the share of days that closed below today, which uses the whole
        distribution and shrugs off one outlier. A name that spiked once and has been calm since will
        show a low rank and a high percentile at the same time — neither is wrong, they answer
        different questions. Rank is the more commonly quoted of the two.
      </span>
    </div>
  );
}

function EnvTooltip({ active, payload, label, unitLabel, currentLabel, method, colour = BRAND }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <ChartTooltip
      title={label}
      rows={[
        { label: currentLabel, value: `${p.level.toFixed(1)}${unitLabel}`, color: colour },
        p.rank !== null && {
          label: `52-week ${method}`,
          value: p.rank.toFixed(0),
          color: RANK_COLOUR,
        },
      ]}
    />
  );
}
