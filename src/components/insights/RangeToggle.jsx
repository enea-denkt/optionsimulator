import { HISTORY_WINDOWS } from '@/lib/volatilityHistory';

const BRAND = '#2188e6';

/**
 * The 3M/6M/1Y/2Y/5Y selector that sits on every time-series chart.
 *
 * One selection is shared by all of them and lives in the URL, so the page reads
 * as a single view over one span rather than a set of charts each zoomed
 * somewhere else — and a shared link reopens on the same span.
 */
export default function RangeToggle({ value, onChange, label = 'Range' }) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs font-medium text-slate-500">{label}</span>}
      <div className="flex rounded-lg border border-slate-200 p-0.5">
        {HISTORY_WINDOWS.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => onChange(w.id)}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              value === w.id ? 'text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
            style={value === w.id ? { backgroundColor: BRAND } : undefined}
          >
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );
}
