import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Shared frame for every chart on the insights page.
 *
 * The important part is `verdict`: a computed sentence stating what the chart
 * shows, sitting between the title and the plot. A chart that needs the reader
 * to already know how to read it is not an insight, so each one says its own
 * conclusion in words and lets the plot back it up.
 */

const TONE_STYLES = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  positive: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  caution: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-sky-200 bg-sky-50 text-sky-900',
};

export default function InsightCard({
  title,
  subtitle,
  icon: Icon,
  verdict,
  tone = 'neutral',
  footnote,
  action,
  children,
}) {
  return (
    <Card className="border-slate-200 shadow-xl">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900 sm:text-lg">
              {Icon && <Icon className="h-5 w-5 shrink-0" style={{ color: '#A0CBF5' }} />}
              <span>{title}</span>
            </CardTitle>
            {subtitle && <p className="mt-1 text-xs text-slate-500 sm:text-sm">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-6">
        {verdict && (
          <p className={`mb-4 rounded-lg border px-3 py-2 text-sm ${TONE_STYLES[tone] || TONE_STYLES.neutral}`}>
            {verdict}
          </p>
        )}
        {children}
        {footnote && <p className="mt-4 text-xs italic text-slate-500">{footnote}</p>}
      </CardContent>
    </Card>
  );
}

/** Tooltip shell so every chart's hover card looks the same. */
export function ChartTooltip({ title, rows }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
      {title && <p className="mb-1 text-sm font-semibold text-slate-900">{title}</p>}
      <div className="space-y-0.5">
        {rows.filter(Boolean).map((row) => (
          <p key={row.label} className="flex items-center gap-3 text-xs">
            <span className="text-slate-500">{row.label}</span>
            <span className="ml-auto font-semibold" style={{ color: row.color || '#0f172a' }}>
              {row.value}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}
