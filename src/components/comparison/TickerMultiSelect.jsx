import { X } from 'lucide-react';
import TickerSearch from '@/components/simulator/TickerSearch';

/**
 * Chips for the chosen tickers plus the ordinary search box to add another.
 *
 * A cap is enforced because every ticker means a full option chain over the
 * network — around 1.5MB each — so an unbounded list would quietly turn into a
 * ten-megabyte page load.
 */
export default function TickerMultiSelect({ value, onChange, max = 6, loadingSymbols = [] }) {
  const add = (symbol) => {
    if (!symbol || value.includes(symbol) || value.length >= max) return;
    onChange([...value, symbol]);
  };

  const remove = (symbol) => onChange(value.filter((s) => s !== symbol));
  const atCapacity = value.length >= max;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {value.map((symbol) => {
          const loading = loadingSymbols.includes(symbol);
          return (
            <span
              key={symbol}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-semibold ${
                loading ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-sky-200 bg-sky-50 text-slate-800'
              }`}
            >
              {symbol}
              <button
                type="button"
                onClick={() => remove(symbol)}
                className="text-slate-400 hover:text-slate-700"
                aria-label={`Remove ${symbol}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          );
        })}
        {value.length === 0 && (
          <span className="text-sm italic text-slate-500">No tickers selected yet.</span>
        )}
      </div>

      <div className={atCapacity ? 'opacity-50' : undefined}>
        <TickerSearch
          value=""
          onSelect={add}
          disabled={atCapacity}
          placeholder={atCapacity ? `Maximum ${max} tickers` : 'Add a ticker...'}
        />
      </div>
    </div>
  );
}
