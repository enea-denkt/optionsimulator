import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Grid3x3 } from 'lucide-react';
import { divergingCss, textOnDiverging } from '@/lib/colorScale';

const TONE = {
  caution: 'border-amber-200 bg-amber-50 text-amber-900',
  positive: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
};

function shortDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}`;
}

/**
 * How much dearer than the benchmark this contract is, at every price and date.
 *
 * The heatmap already on this page colours cells by what the position is
 * *worth*. This one colours by how much of that is being overpaid, which is a
 * different question and the one that decides whether to trade at all. Red is
 * dear, white is fair, blue is cheap, and the ringed cells are the path the
 * scenario walks — so the trajectory is visibly crossing from one region into
 * another rather than sitting at a single point.
 */
export default function RichnessMap({
  grid, verdict, benchmarkVolPct, realizedVolPct, ivPct, onBenchmarkChange, ticker,
}) {
  if (!grid?.cells?.length) return null;

  const { prices, cells, extent, path } = grid;
  const pathAt = new Map(path.map((p) => [`${p.column}:${p.row}`, p]));
  // Rows run high price at the top, the way a price axis is always drawn.
  const rowOrder = prices.map((_, i) => prices.length - 1 - i);

  return (
    <Card className="border-slate-200 shadow-xl mb-6">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white pb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-xl font-semibold text-slate-900 flex items-center gap-2">
              <Grid3x3 className="w-5 h-5" style={{ color: '#A0CBF5' }} />
              Is the Premium Expensive, at Every Price and Date?
            </CardTitle>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Each cell is what this contract costs at the market&apos;s volatility, minus what it is
              worth at the benchmark. Red is dear, white is fair, blue is cheap. The ringed cells are
              where your scenario takes it.
            </p>
          </div>

          <div className="w-56 shrink-0">
            <div className="flex items-center justify-between">
              <label htmlFor="bench" className="text-xs font-medium text-slate-600">Benchmark volatility</label>
              <span className="text-sm font-semibold" style={{ color: '#2188e6' }}>{benchmarkVolPct.toFixed(1)}%</span>
            </div>
            <input
              id="bench"
              type="range"
              min={5}
              max={Math.max(200, Math.ceil(ivPct * 1.5))}
              step={1}
              value={benchmarkVolPct}
              onChange={(e) => onBenchmarkChange(Number(e.target.value))}
              className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-[#2188e6]"
            />
            <p className="mt-1 text-[11px] leading-snug text-slate-500">
              {realizedVolPct > 0 ? (
                <>
                  Defaults to {realizedVolPct.toFixed(1)}%, what {ticker || 'the stock'} has actually
                  delivered over 30 days.{' '}
                  {Math.abs(benchmarkVolPct - realizedVolPct) > 0.5 && (
                    <button
                      type="button"
                      className="underline hover:text-slate-700"
                      onClick={() => onBenchmarkChange(Number(realizedVolPct.toFixed(1)))}
                    >
                      Reset
                    </button>
                  )}
                </>
              ) : (
                'No price history, so pick the volatility you think is fair.'
              )}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        {/* With the benchmark sitting on implied, every cell is zero by
            construction and the verdict would be a tautology. Say so instead. */}
        {extent < 0.005 ? (
          <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            The benchmark is the same volatility the market is charging, so every cell reads zero —
            not because the premium is fair, but because nothing is being compared. Move the slider
            to a volatility you believe in, or pick a ticker and it will default to what that stock
            has actually delivered.
          </p>
        ) : verdict && (
          <p className={`mb-4 rounded-lg border px-3 py-2 text-sm ${TONE[verdict.tone] || TONE.neutral}`}>
            <strong>{verdict.label}.</strong> {verdict.headline}
          </p>
        )}

        {/* Wide grid on a phone: scroll the grid, never the page. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-[10px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-2 py-1 text-right font-medium text-slate-500">
                  {ticker || 'Price'}
                </th>
                {cells.map((c) => (
                  <th key={c.date} className="px-1 py-1 text-center font-medium text-slate-500">
                    {shortDate(c.date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowOrder.map((rowIndex) => (
                <tr key={prices[rowIndex]}>
                  <th className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-0.5 text-right font-medium tabular-nums text-slate-600">
                    ${prices[rowIndex].toFixed(prices[rowIndex] < 25 ? 2 : 0)}
                  </th>
                  {cells.map((c, column) => {
                    const cell = c.row[rowIndex];
                    const marked = pathAt.get(`${column}:${rowIndex}`);
                    return (
                      <td
                        key={c.date}
                        title={
                          `$${cell.price.toFixed(2)} on ${c.date}, ${Math.round(c.remaining)} days left\n` +
                          `At ${c.iv.toFixed(1)}% implied: $${cell.market.toFixed(2)}\n` +
                          `At ${benchmarkVolPct.toFixed(1)}% benchmark: $${cell.benchmark.toFixed(2)}\n` +
                          `Overpay: $${cell.gap.toFixed(2)}` +
                          (marked ? '\n— your scenario passes through here' : '')
                        }
                        className={`px-1 py-0.5 text-center tabular-nums ${marked ? 'ring-2 ring-inset ring-slate-900' : ''}`}
                        style={{
                          backgroundColor: divergingCss(cell.gap, extent),
                          color: textOnDiverging(cell.gap, extent),
                        }}
                      >
                        {cell.gap >= 0.005 || cell.gap <= -0.005 ? cell.gap.toFixed(2) : '·'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600">
          <span className="flex items-center gap-2">
            <span
              className="h-3 w-28 rounded-sm"
              style={{ background: `linear-gradient(to right, ${divergingCss(-extent, extent)}, ${divergingCss(0, extent)}, ${divergingCss(extent, extent)})` }}
            />
            −${extent.toFixed(2)} cheap · fair · dear +${extent.toFixed(2)}
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-4 rounded-sm ring-2 ring-inset ring-slate-900" />
            Where your scenario goes
          </span>
        </div>

        <p className="mt-4 text-xs italic text-slate-500">
          Cells are a dollar gap per share, not a ratio: a ratio is unbounded where both numbers are
          pennies, so it paints the whole far out-of-the-money corner scarlet over a two-cent
          difference. The gap peaks near the money and near the front, which is where the money is.
          It falls to nothing at expiry because only intrinsic value is left by then and volatility —
          whoever is right about it — no longer prices anything. Implied volatility cannot judge
          itself, so the comparison is against the benchmark above and nothing else.
        </p>
      </CardContent>
    </Card>
  );
}
