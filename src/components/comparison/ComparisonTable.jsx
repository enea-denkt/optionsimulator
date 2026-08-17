import { ArrowDown, ArrowUp } from 'lucide-react';
import { METRICS } from '@/lib/optionComparison';
import { formatExpiration } from '@/api/marketData';

/**
 * The comparison itself. A table rather than a chart, because the question is
 * "which of these is dearest, and on what measure" — that is a ranking across
 * several columns at once, which a table answers and a single bar chart cannot.
 *
 * The chosen metric is highlighted and the extremes are tinted, so the answer is
 * visible without reading every cell.
 */
export default function ComparisonTable({ rows, metricId, sort, onSortChange }) {
  if (!rows.length) return null;

  const values = rows.map((r) => r[metricId]).filter(Number.isFinite);
  const dearest = values.length ? Math.max(...values) : null;
  const cheapest = values.length ? Math.min(...values) : null;

  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    const an = Number.isFinite(av) ? av : -Infinity;
    const bn = Number.isFinite(bv) ? bv : -Infinity;
    return sort.dir === 'asc' ? an - bn : bn - an;
  });

  const toggle = (key) =>
    onSortChange({ key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' });

  const Header = ({ label, sortKey, hint, highlight, numeric = true }) => (
    <th
      scope="col"
      className={`whitespace-nowrap px-3 py-2 font-medium ${numeric ? 'text-right' : 'text-left'} ${
        highlight ? 'bg-sky-50 text-slate-900' : 'text-slate-600'
      }`}
      title={hint}
    >
      <button
        type="button"
        onClick={() => toggle(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-slate-900 ${numeric ? 'flex-row-reverse' : ''}`}
      >
        {sort.key === sortKey &&
          (sort.dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
        {label}
      </button>
    </th>
  );

  return (
    // Wide table on a phone: scroll the table, never the page.
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide">
          <tr>
            <Header label="Ticker" sortKey="symbol" numeric={false} />
            <Header label="Share price" sortKey="spot" hint="Latest delayed quote" />
            <Header label="Strike" sortKey="strike" hint="The strike chosen on this name's chain" />
            <Header label="Delta" sortKey="delta" hint="Roughly the market's odds the option finishes in the money" />
            <Header label="Expiry" sortKey="dte" hint="Days to expiration" />
            <Header label="Premium" sortKey="premium" hint="Mid of bid and ask" />
            {METRICS.map((m) => (
              <Header
                key={m.id}
                label={m.short}
                sortKey={m.id}
                hint={m.hint}
                highlight={m.id === metricId}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const value = row[metricId];
            const isDearest = Number.isFinite(value) && value === dearest && values.length > 1;
            const isCheapest = Number.isFinite(value) && value === cheapest && values.length > 1;

            return (
              <tr key={row.symbol} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-900">
                  {row.symbol}
                </th>
                <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">${row.spot.toFixed(2)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">
                  ${row.strike}
                  <span className="ml-1 text-xs text-slate-400">
                    {row.moneyness ? `${((row.moneyness - 1) * 100).toFixed(0)}%` : ''}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">
                  {row.delta === null || row.delta === undefined ? '—' : Math.abs(row.delta).toFixed(2)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">
                  {row.dte}d
                  <span className="ml-1 text-xs text-slate-400">{formatExpiration(row.expiration)}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-slate-600">${row.premium.toFixed(2)}</td>

                {METRICS.map((m) => {
                  const highlighted = m.id === metricId;
                  return (
                    <td
                      key={m.id}
                      className={`whitespace-nowrap px-3 py-2 text-right ${
                        highlighted
                          ? `font-semibold ${isDearest ? 'bg-rose-50 text-rose-700' : isCheapest ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-slate-900'}`
                          : 'text-slate-600'
                      }`}
                    >
                      {m.format(row[m.id])}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
