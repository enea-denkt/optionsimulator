import { useMemo } from 'react';
import { Crown } from 'lucide-react';
import { viridisCss, scalePosition, textOn, formatK } from '@/lib/colorScale';
import { formatExpiration } from '@/api/marketData';

/**
 * One ticker, one measure, laid out the way Heatseeker does it: strikes
 * descending down the left, expirations across the top, the dollar figure
 * written in each cell over a viridis background.
 *
 * Three things carry the reading:
 *
 *   - **The King node** — the largest absolute value in the panel, starred.
 *     Skylit's own framing is that price gravitates toward it near expiration
 *     and that market makers tend to pin around it late in a session.
 *   - **The spot row**, called out on the left so distance to each node is
 *     immediately legible.
 *   - **The scale**, computed per panel and shown as a legend bar, because
 *     magnitudes differ by orders of magnitude between names.
 *
 * Dark theme, unlike the rest of the app: viridis is built for dark backgrounds
 * and washes out badly on white.
 */
export default function ExposurePanel({
  symbol, price, changePercent, metric, cells, strikes, expirations, spot, maxRows = 40,
}) {
  const { lookup, min, max, king } = useMemo(() => {
    const map = new Map();
    let lo = Infinity;
    let hi = -Infinity;
    let bestCell = null;

    for (const c of cells) {
      map.set(`${c.expiration}|${c.strike}`, c);
      lo = Math.min(lo, c.value);
      hi = Math.max(hi, c.value);
      if (!bestCell || Math.abs(c.value) > Math.abs(bestCell.value)) bestCell = c;
    }

    return {
      lookup: map,
      min: Number.isFinite(lo) ? lo : 0,
      max: Number.isFinite(hi) ? hi : 0,
      king: bestCell,
    };
  }, [cells]);

  // Strikes descend so the axis reads like a price chart, and the window is
  // centred on spot rather than truncated from one end.
  const visibleStrikes = useMemo(() => {
    const sorted = [...strikes].sort((a, b) => b - a);
    if (sorted.length <= maxRows) return sorted;
    const centre = sorted.reduce(
      (best, s, i) => (Math.abs(s - spot) < Math.abs(sorted[best] - spot) ? i : best), 0,
    );
    const start = Math.max(0, Math.min(sorted.length - maxRows, centre - Math.floor(maxRows / 2)));
    return sorted.slice(start, start + maxRows);
  }, [strikes, spot, maxRows]);

  const nearestToSpot = visibleStrikes.reduce(
    (best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best),
    visibleStrikes[0],
  );

  if (!visibleStrikes.length || !expirations.length) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-6 text-center text-sm text-slate-400">
        No open interest to map for {symbol}.
      </div>
    );
  }

  const up = (changePercent ?? 0) >= 0;

  return (
    <div className="flex min-w-[420px] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-3 py-2">
        <span className="rounded-md bg-slate-800 px-2 py-1 text-sm font-semibold text-white">{symbol}</span>
        <span className="text-sm font-semibold text-white">
          ${price?.toFixed(2)}
          {changePercent !== null && changePercent !== undefined && (
            <span className={`ml-2 text-xs font-medium ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
              {up ? '+' : ''}{changePercent.toFixed(2)}%
            </span>
          )}
        </span>
        <span className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium uppercase tracking-wide text-amber-300">
          {metric}
        </span>
      </div>

      {king && (
        <div className="flex items-center gap-2 border-b border-slate-700 px-3 py-1.5 text-xs text-slate-300">
          <Crown className="h-3.5 w-3.5 text-amber-300" />
          <span>
            King node <strong className="text-white">{king.strike}</strong> on{' '}
            {formatExpiration(king.expiration)} · {formatK(king.value)}
          </span>
        </div>
      )}

      {/* Grid */}
      <div className="overflow-x-auto">
        <div
          className="grid min-w-full text-[10px] tabular-nums"
          style={{ gridTemplateColumns: `56px repeat(${expirations.length}, minmax(84px, 1fr))` }}
        >
          <div className="sticky left-0 z-10 border-b border-slate-700 bg-slate-900 px-2 py-1.5 font-semibold text-slate-400">
            Strike
          </div>
          {expirations.map((e) => (
            <div
              key={e.expiration}
              className="border-b border-slate-700 bg-slate-900 px-1 py-1.5 text-center font-medium text-slate-300"
            >
              {e.expiration}
            </div>
          ))}

          {visibleStrikes.map((strike) => {
            const isSpot = strike === nearestToSpot;
            return (
              <StrikeRow
                key={strike}
                strike={strike}
                isSpot={isSpot}
                expirations={expirations}
                lookup={lookup}
                min={min}
                max={max}
                king={king}
              />
            );
          })}
        </div>
      </div>

      {/* Legend: the panel's own min to max, as a continuous ramp */}
      <div className="flex items-center gap-2 border-t border-slate-700 px-3 py-2 text-[10px] text-slate-400">
        <span className="shrink-0 tabular-nums">{formatK(min)}</span>
        <span
          className="h-2 flex-1 rounded-sm"
          style={{
            background: `linear-gradient(to right, ${[0, 0.2, 0.4, 0.6, 0.8, 1]
              .map((t) => viridisCss(t))
              .join(', ')})`,
          }}
        />
        <span className="shrink-0 tabular-nums">{formatK(max)}</span>
      </div>
    </div>
  );
}

function StrikeRow({ strike, isSpot, expirations, lookup, min, max, king }) {
  return (
    <>
      <div
        className={`sticky left-0 z-10 flex items-center gap-1 px-2 py-1 ${
          isSpot ? 'bg-white font-bold text-slate-900' : 'bg-slate-900 text-slate-400'
        }`}
      >
        {strike}
      </div>

      {expirations.map((e) => {
        const cell = lookup.get(`${e.expiration}|${strike}`);
        const value = cell?.value ?? 0;
        const t = scalePosition(value, min, max);
        const isKing = king && cell && cell.expiration === king.expiration && cell.strike === king.strike;

        return (
          <div
            key={e.expiration}
            className={`flex items-center justify-end gap-1 px-1.5 py-1 ${isKing ? 'ring-1 ring-inset ring-amber-300' : ''}`}
            style={{ backgroundColor: viridisCss(t), color: textOn(t) }}
            title={
              cell
                ? `${e.expiration} · strike ${strike}\n${formatK(value)}\nOpen interest ${cell.oi.toLocaleString()} (${cell.callOI.toLocaleString()} calls, ${cell.putOI.toLocaleString()} puts)`
                : `${e.expiration} · strike ${strike}\nnothing open`
            }
          >
            {isKing && <span className="text-amber-500">★</span>}
            <span>{formatK(value)}</span>
          </div>
        );
      })}
    </>
  );
}
