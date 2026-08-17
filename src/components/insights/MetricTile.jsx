/**
 * One headline number with the plain-English question it answers underneath.
 *
 * The label is phrased as what the reader wants to know rather than as jargon
 * ("Implied move by expiry", not "1σ move"), with the technical name kept as
 * the hint so the two stay connected.
 */
export default function MetricTile({ label, value, hint, tone = 'default', loading }) {
  const valueColor = {
    default: 'text-slate-900',
    positive: 'text-emerald-600',
    negative: 'text-rose-600',
    brand: '',
  }[tone];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      {loading ? (
        <div className="mt-2 h-7 w-20 animate-pulse rounded bg-slate-100" />
      ) : (
        <p
          className={`mt-1 text-xl font-bold sm:text-2xl ${valueColor}`}
          style={tone === 'brand' ? { color: '#2188e6' } : undefined}
        >
          {value ?? '—'}
        </p>
      )}
      {hint && <p className="mt-1 text-xs leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}
