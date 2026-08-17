import { useMemo } from 'react';
import { formatExposure } from '@/lib/gammaExposure';
import { formatExpiration } from '@/api/marketData';

/**
 * Exposure as expiration across, strike down — the topographic view of where
 * hedging pressure sits.
 *
 * Built from CSS grid rather than a charting library: what is wanted is a dense
 * matrix of labelled cells that reflows on a phone, which is a layout problem
 * rather than a plotting one, and recharts has no heatmap primitive anyway.
 *
 * Colour is diverging around zero, and intensity is scaled by the square root of
 * the magnitude. A linear scale would leave every cell invisible next to the one
 * or two enormous strikes that dominate any chain.
 */

const POSITIVE = [33, 136, 230];  // brand blue — dealers long gamma, moves damped
const NEGATIVE = [255, 35, 0];    // red — dealers short gamma, moves amplified
const NEUTRAL = [148, 163, 184];  // slate, for open interest which has no sign

function cellColour(value, max, diverging) {
  if (!max || !Number.isFinite(value)) return 'transparent';
  const intensity = Math.min(1, Math.sqrt(Math.abs(value) / max));
  const [r, g, b] = diverging ? (value >= 0 ? POSITIVE : NEGATIVE) : NEUTRAL;
  return `rgba(${r}, ${g}, ${b}, ${(intensity * 0.85).toFixed(3)})`;
}

export default function ExposureHeatmap({ cells, strikes, expirations, spot, metric, keyLevels }) {
  const { lookup, max } = useMemo(() => {
    const map = new Map();
    let peak = 0;
    for (const c of cells) {
      map.set(`${c.expiration}|${c.strike}`, c);
      peak = Math.max(peak, Math.abs(c.value));
    }
    return { lookup: map, max: peak };
  }, [cells]);

  const diverging = metric !== 'oi';
  // Strikes descend so the price axis reads the way a chart does.
  const orderedStrikes = [...strikes].sort((a, b) => b - a);

  if (!orderedStrikes.length || !expirations.length) {
    return <p className="py-10 text-center text-sm text-slate-500">No open interest to map at these strikes.</p>;
  }

  const nearestToSpot = orderedStrikes.reduce(
    (best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best),
    orderedStrikes[0],
  );

  const label = { gex: 'Gamma exposure', vex: 'Vanna exposure', oi: 'Open interest' }[metric];

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <div
          className="grid min-w-[640px] text-[10px]"
          style={{ gridTemplateColumns: `72px repeat(${expirations.length}, minmax(56px, 1fr))` }}
        >
          {/* Header row */}
          <div className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-2 py-2 font-semibold text-slate-500">
            Strike
          </div>
          {expirations.map((e) => (
            <div
              key={e.expiration}
              className="border-b border-slate-200 bg-slate-50 px-1 py-2 text-center font-medium text-slate-600"
              title={formatExpiration(e.expiration)}
            >
              <div>{formatExpiration(e.expiration).replace(/,.*/, '')}</div>
              <div className="text-slate-400">{e.dte}d</div>
            </div>
          ))}

          {/* One row per strike */}
          {orderedStrikes.map((strike) => {
            const isSpotRow = strike === nearestToSpot;
            const isCallWall = keyLevels?.callWall?.strike === strike;
            const isPutWall = keyLevels?.putWall?.strike === strike;

            return (
              <Row
                key={strike}
                strike={strike}
                isSpotRow={isSpotRow}
                isCallWall={isCallWall}
                isPutWall={isPutWall}
                expirations={expirations}
                lookup={lookup}
                max={max}
                diverging={diverging}
                metric={metric}
                label={label}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
        {diverging ? (
          <>
            <Swatch colour={`rgb(${POSITIVE.join(',')})`}>Positive — hedging damps moves</Swatch>
            <Swatch colour={`rgb(${NEGATIVE.join(',')})`}>Negative — hedging amplifies moves</Swatch>
          </>
        ) : (
          <Swatch colour={`rgb(${NEUTRAL.join(',')})`}>Contracts open</Swatch>
        )}
        <span className="text-slate-400">Deeper colour means more of it. Peak cell: {formatExposure(max)}</span>
      </div>
    </div>
  );
}

function Row({ strike, isSpotRow, isCallWall, isPutWall, expirations, lookup, max, diverging, metric, label }) {
  const marker = isCallWall ? 'call wall' : isPutWall ? 'put wall' : isSpotRow ? 'spot' : null;

  return (
    <>
      <div
        className={`sticky left-0 z-10 flex items-center justify-between gap-1 border-r border-slate-200 px-2 py-1 tabular-nums ${
          isSpotRow ? 'bg-slate-900 font-semibold text-white' : 'bg-white text-slate-600'
        }`}
      >
        <span>{strike}</span>
        {marker && (
          <span
            className={`rounded px-1 text-[9px] font-medium ${
              isSpotRow ? 'bg-white/20 text-white' : isCallWall ? 'bg-sky-100 text-sky-700' : 'bg-rose-100 text-rose-700'
            }`}
          >
            {marker}
          </span>
        )}
      </div>

      {expirations.map((e) => {
        const cell = lookup.get(`${e.expiration}|${strike}`);
        const value = cell?.value ?? 0;
        return (
          <div
            key={e.expiration}
            className="border-b border-l border-slate-100"
            style={{ backgroundColor: cellColour(value, max, diverging) }}
            title={
              cell
                ? `${formatExpiration(e.expiration)} · strike ${strike}\n${label}: ${
                    metric === 'oi' ? cell.oi.toLocaleString() : formatExposure(value)
                  }\nOpen interest: ${cell.oi.toLocaleString()} (${cell.callOI.toLocaleString()} calls, ${cell.putOI.toLocaleString()} puts)`
                : `${formatExpiration(e.expiration)} · strike ${strike}\nnothing open`
            }
          />
        );
      })}
    </>
  );
}

function Swatch({ colour, children }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-3 w-6 rounded-sm" style={{ backgroundColor: colour }} />
      {children}
    </span>
  );
}
