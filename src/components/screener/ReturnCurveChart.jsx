import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { LineChart as LineChartIcon } from 'lucide-react';
import InsightCard from './../insights/InsightCard';
import { contractLabel, formatReturn } from '@/lib/contractScreener';

/**
 * Tableau's categorical palette, which is built to stay distinguishable at
 * twenty series — the point at which most palettes have run out of hues and
 * start repeating.
 *
 * It is rotated so its blue does not open the run: the shares are drawn in the
 * app's blue and dashed, and a solid Tableau blue immediately beneath it would
 * read as a second benchmark rather than a contract.
 */
export const TABLEAU_20 = [
  '#F28E2B', '#E15759', '#59A14F', '#B07AA1', '#EDC948',
  '#76B7B2', '#FF9DA7', '#9C755F', '#4E79A7', '#BAB0AC',
  '#FFBE7D', '#FF9D9A', '#8CD17D', '#D4A6C8', '#B6992D',
  '#86BCB6', '#D7B5A6', '#79706E', '#A0CBE8', '#F1CE63',
];

const SHARES = '#2188e6';

/**
 * Return against the underlying's move, for the shares and for the top-ranked
 * contracts.
 *
 * The x-axis is the move in the stock, not time, because the question the page
 * asks is "if I am right by this much, what do I get?" — and the answer is a
 * curve, not a number. The straight dashed line is the shares: every contract
 * that sits above it beats simply owning them, and where it crosses back below
 * is the size of move at which the leverage stops paying for itself.
 */
export default function ReturnCurveChart({
  data, rows, spot, expectedMovePct, basis, count, onCountChange, maxCount,
}) {
  if (!data.length) return null;

  const { domain, axisWidth, ticks } = returnAxis(data, rows, count);

  return (
    <InsightCard
      title="What each contract returns, against simply owning the shares"
      subtitle={
        basis === 'now'
          ? 'Repriced today at each level, with your implied-volatility view applied. Curved, because time value is still on the contract.'
          : 'Value at each contract’s own expiration against what you paid. Straight, because only intrinsic value is left by then.'
      }
      icon={LineChartIcon}
      footnote={
        `The axis runs well past your view on both sides, so the far right is a bigger move than you asked for and ` +
        'pays more than the table says. The table reads off the marked point only. ' +
        'Every line starts at −100%: the premium is the whole of what an option buyer can lose, and below the strike ' +
        'that is exactly what happens. The shares lose only what the stock loses. That trade — a floor on the downside ' +
        'in exchange for needing to be right about size and timing — is the entire decision this page is for.'
      }
      action={
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap text-xs font-medium text-slate-500">
            Top {count}
          </span>
          <input
            type="range"
            min={1}
            max={maxCount}
            step={1}
            value={count}
            onChange={(e) => onCountChange(Number(e.target.value))}
            aria-label="How many contracts to plot"
            className="h-1.5 w-32 cursor-pointer appearance-none rounded-full bg-slate-200 accent-[#2188e6]"
          />
        </div>
      }
    >
      <ResponsiveContainer width="100%" height={420}>
        <LineChart data={data} margin={{ top: 30, right: 16, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="movePct"
            type="number"
            domain={['dataMin', 'dataMax']}
            stroke="#64748b"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
            label={{ value: 'Move in the share price', position: 'insideBottom', offset: -16, style: { fontSize: 12, fill: '#64748b' } }}
          />
          <YAxis
            stroke="#64748b"
            tick={{ fontSize: 11 }}
            width={axisWidth}
            domain={domain}
            // Explicit ticks, not a count: given only a count recharts re-rounds
            // the domain to suit them and reopens the empty space above the data
            // that fitting the domain just closed.
            ticks={ticks}
            tickFormatter={(v) => formatReturn(v)}
            label={{ value: 'Return on premium', angle: -90, position: 'insideLeft', offset: 4, style: { fontSize: 12, fill: '#64748b' } }}
          />
          <Tooltip content={<CurveTooltip rows={rows} count={count} spot={spot} />} />

          <ReferenceLine y={0} stroke="#94a3b8" />
          <ReferenceLine
            x={expectedMovePct}
            stroke="#0f172a"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            label={{
              value: `Your view: ${expectedMovePct > 0 ? '+' : ''}${expectedMovePct}% — the table reads here`,
              position: 'top',
              style: { fontSize: 11, fontWeight: 600, fill: '#0f172a' },
            }}
          />

          {/* Drawn first so the contracts sit on top of the benchmark. */}
          <Line
            dataKey="shares"
            name="Owning the shares"
            stroke={SHARES}
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={markerDot(SHARES, expectedMovePct)}
            isAnimationActive={false}
          />
          {rows.slice(0, count).map((row, i) => (
            <Line
              key={row.occSymbol}
              dataKey={`c${i}`}
              name={contractLabel(row)}
              stroke={TABLEAU_20[i % TABLEAU_20.length]}
              strokeWidth={1.8}
              dot={markerDot(TABLEAU_20[i % TABLEAU_20.length], expectedMovePct)}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
        <span className="flex items-center gap-2">
          <svg width="22" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="22" y2="4" stroke={SHARES} strokeWidth="2" strokeDasharray="6 4" />
          </svg>
          Owning the shares
        </span>
        {rows.slice(0, count).map((row, i) => (
          <span key={row.occSymbol} className="flex items-center gap-2">
            <svg width="22" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="22" y2="4" stroke={TABLEAU_20[i % TABLEAU_20.length]} strokeWidth="2" />
            </svg>
            <span className="text-slate-500">#{i + 1}</span> {contractLabel(row)}
          </span>
        ))}
      </div>
    </InsightCard>
  );
}

/**
 * Y bounds fitted to the lines, plus the room their labels need.
 *
 * Recharts' own tick-rounding is built for ordinary ranges: given a series that
 * tops out near 850,000% it picks an axis reaching 1,800,000% and spends two
 * thirds of the plot on empty space above the data and below −100%, which no
 * option can reach anyway.
 */
function returnAxis(data, rows, count) {
  const keys = ['shares', ...rows.slice(0, count).map((_, i) => `c${i}`)];
  let low = Infinity;
  let high = -Infinity;
  for (const point of data) {
    for (const key of keys) {
      const v = point[key];
      if (!Number.isFinite(v)) continue;
      if (v < low) low = v;
      if (v > high) high = v;
    }
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return { domain: ['auto', 'auto'], ticks: undefined, axisWidth: 78 };
  }

  // Fitting the domain to the data is only half of it: given exact bounds
  // recharts spaces its ticks evenly between them and prints −89,947% and
  // +410,053%. Pick a round step, place the ticks on multiples of it, and every
  // label is a number worth reading.
  //
  // Only the top is rounded out to a whole step. Rounding the bottom too spent a
  // quarter of the plot on space below −500,000% when nothing can fall past
  // −100%: an option buyer's loss is capped at the premium, so the floor of this
  // chart is always −100% however large the step above it grows.
  const step = niceStep(high - low || 1);
  const lower = low - (high - low) * 0.03;
  const upper = Math.ceil(high / step) * step;
  const bounds = [lower, upper];

  // Wide enough for the longest label the axis can print — "−1,200,000%" does
  // not fit the default gutter.
  const widest = Math.max(...bounds.map((v) => formatReturn(v).length));

  const ticks = [];
  for (let v = Math.ceil(lower / step) * step; v <= upper + step / 2; v += step) ticks.push(Math.round(v));

  return { domain: bounds, ticks, axisWidth: Math.max(64, widest * 7 + 12) };
}

/** A round step — 1, 2, 2.5 or 5 times a power of ten — giving about six ticks. */
function niceStep(range, targetTicks = 6) {
  const raw = range / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const rounded = normalized <= 1 ? 1
    : normalized <= 2 ? 2
      : normalized <= 2.5 ? 2.5
        : normalized <= 5 ? 5
          : 10;
  return rounded * magnitude;
}

/**
 * A dot on one x only — where the view sits — so each line visibly touches the
 * number its row in the table reports. Recharts calls this for every point, so
 * everything else returns null rather than drawing.
 */
function markerDot(colour, at) {
  const Marker = ({ cx, cy, payload }) =>
    payload?.movePct === at && Number.isFinite(cy) ? (
      <circle cx={cx} cy={cy} r={4} fill={colour} stroke="#fff" strokeWidth={1.5} />
    ) : null;
  return <Marker />;
}

function CurveTooltip({ active, payload, label, rows, count, spot }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const pct = formatReturn;

  // Ranked by what each line is worth at this price, not by the table's order:
  // the whole point of hovering is to see which contract wins *here*.
  const lines = rows
    .slice(0, count)
    .map((row, i) => ({ row, index: i, value: point[`c${i}`] }))
    .filter((l) => Number.isFinite(l.value))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="max-w-xs rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
      <p className="mb-1 text-sm font-semibold text-slate-900">
        {`${pct(label)} → $${(spot * (1 + label / 100)).toFixed(2)}`}
      </p>
      <p className="mb-2 flex items-center gap-3 text-xs">
        <span className="text-slate-500">Owning the shares</span>
        <span className="ml-auto font-semibold" style={{ color: SHARES }}>{pct(point.shares)}</span>
      </p>
      <div className="space-y-0.5 border-t border-slate-100 pt-1.5">
        {lines.map((l) => (
          <p key={l.row.occSymbol} className="flex items-center gap-3 text-xs">
            <span className="truncate text-slate-500">{contractLabel(l.row)}</span>
            <span
              className="ml-auto font-semibold"
              style={{ color: TABLEAU_20[l.index % TABLEAU_20.length] }}
            >
              {pct(l.value)}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}
