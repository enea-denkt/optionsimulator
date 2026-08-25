import { formatExpiration } from '@/api/marketData';
import { TABLEAU_20 } from './ReturnCurveChart';

/**
 * The ranking itself.
 *
 * A table rather than a chart, because the answer is an ordered list with the
 * catch attached to each row: the return is one column, what it costs and how
 * likely it is are the next two. The colour swatch ties each row to its line in
 * the chart above, so the two read as one object.
 *
 * `compact` drops the secondary columns so two of these fit side by side — the
 * best contracts and the worst read as one comparison that way, which is the
 * whole reason for showing the bottom of the list at all. Nothing is lost: every
 * dropped figure is on the row's hover title.
 */
export default function ResultsTable({
  rows, spot, basis, plotted = 0, startRank = 1, descending = false, compact = false, footnote,
}) {
  if (!rows.length) return null;

  const pct = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(0)}%` : '—');
  const headline = (r) => (basis === 'now' ? r.returnNowPct : r.returnAtExpiryPct);
  // Only the top of the ranking has a winner to point at. Tinting the first row
  // of the bottom table would mark the least-bad loser as the best of the lot.
  const best = descending ? null : headline(rows[0]);

  // Everything the compact layout leaves out, so hovering a row still answers
  // "what would I actually be paying, and where does it break even".
  const detail = (r) =>
    [
      `Bid ${r.bid.toFixed(2)} / ask ${r.ask.toFixed(2)}`,
      r.iv === null ? null : `IV ${r.iv.toFixed(0)}%${basis === 'now' && r.movedIV !== null ? ` → ${r.movedIV.toFixed(0)}%` : ''}`,
      `Breakeven $${r.breakeven.toFixed(2)} (${pct(r.moveToBreakevenPct)})`,
      `Profit at expiry ${r.profitAtExpiry > 0 ? '+' : '−'}$${Math.abs(r.profitAtExpiry).toFixed(0)}`,
      `Open interest ${r.openInterest.toLocaleString()}`,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    // Wide table on a phone: scroll the table, never the page.
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-lg">
      <table className={`w-full border-collapse text-sm ${compact ? 'min-w-[40rem]' : 'min-w-[64rem]'}`}>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs">
            <Th left>#</Th>
            <Th left>Contract</Th>
            <Th hint="Calendar days until this contract expires">Days</Th>
            <Th hint="What one contract costs at the ask, 100 shares">Cost</Th>
            {!compact && <Th hint="Bid and ask — a wide gap means you will not get this price">Bid / ask</Th>}
            <Th highlight={basis === 'expiry'} hint="Intrinsic value at expiry against what you paid">
              At expiry
            </Th>
            <Th highlight={basis === 'now'} hint="Repriced today if the move happened now, with your IV view">
              If it happens now
            </Th>
            {!compact && <Th hint="Profit in dollars on one contract, at expiry">Profit</Th>}
            {!compact && <Th hint="Where the share price must reach before this contract breaks even">Breakeven</Th>}
            <Th hint="The market's own estimate of the odds this finishes in the money">Delta</Th>
            {!compact && (
              <Th hint={basis === 'now'
                ? 'Implied volatility today, and what it becomes at your target once the contract slides along the smile'
                : 'Implied volatility quoted for this contract today'}
              >
                IV
              </Th>
            )}
            {!compact && <Th hint="Open interest — how many contracts are held">Open int.</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const rank = descending ? startRank - i : startRank + i;
            return (
              <tr
                key={row.occSymbol}
                title={detail(row)}
                className={`border-b border-slate-100 last:border-0 ${i % 2 ? 'bg-slate-50/40' : ''}`}
              >
                <td className="whitespace-nowrap px-3 py-2 text-left tabular-nums text-slate-500">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: i < plotted ? TABLEAU_20[i % TABLEAU_20.length] : '#e2e8f0',
                      }}
                      title={i < plotted ? 'Plotted in the chart above' : 'Not plotted'}
                    />
                    {rank.toLocaleString()}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-left font-medium text-slate-900">
                  ${row.strike}{' '}
                  <span className={row.optionType === 'call' ? 'text-emerald-600' : 'text-rose-600'}>
                    {row.optionType}
                  </span>{' '}
                  <span className="text-slate-400">·</span>{' '}
                  <span className="text-slate-600">{formatExpiration(row.expiration)}</span>
                  {!row.isStandardRoot && (
                    <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-500">{row.root}</span>
                  )}
                </td>
                <Td>{row.dte}</Td>
                <Td>${row.cost.toFixed(0)}</Td>
                {!compact && <Td muted>{row.bid.toFixed(2)} / {row.ask.toFixed(2)}</Td>}
                <Td
                  strong={basis === 'expiry'}
                  tone={row.returnAtExpiryPct > 0 ? 'good' : 'bad'}
                  highlight={best !== null && basis === 'expiry' && headline(row) === best}
                >
                  {pct(row.returnAtExpiryPct)}
                </Td>
                <Td
                  strong={basis === 'now'}
                  tone={row.returnNowPct > 0 ? 'good' : 'bad'}
                  highlight={best !== null && basis === 'now' && headline(row) === best}
                >
                  {pct(row.returnNowPct)}
                </Td>
                {!compact && (
                  <Td tone={row.profitAtExpiry > 0 ? 'good' : 'bad'}>
                    {row.profitAtExpiry > 0 ? '+' : '−'}${Math.abs(row.profitAtExpiry).toFixed(0)}
                  </Td>
                )}
                {!compact && (
                  <Td muted>
                    ${row.breakeven.toFixed(2)}
                    <span className="ml-1 text-slate-400">({pct(row.moveToBreakevenPct)})</span>
                  </Td>
                )}
                <Td muted>{row.delta === null ? '—' : Math.abs(row.delta).toFixed(2)}</Td>
                {!compact && (
                  <Td muted>
                    {row.iv === null ? '—' : `${row.iv.toFixed(0)}%`}
                    {basis === 'now' && row.movedIV !== null && (
                      <span className="ml-1 text-slate-400">→ {row.movedIV.toFixed(0)}%</span>
                    )}
                  </Td>
                )}
                {!compact && <Td muted>{row.openInterest.toLocaleString()}</Td>}
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="border-t border-slate-100 px-3 py-2 text-xs italic text-slate-500">
        {footnote || (
          <>
            Priced off the ask, so the cost is what opening the position would actually take, not the
            mid. Contracts with no bid are excluded — an ask nobody bids against is a quote, not a
            market. Shares at ${spot.toFixed(2)}. Delta is shown because the top of any return
            ranking is the contract that needs you to be most exactly right.
          </>
        )}
      </p>
    </div>
  );
}

function Th({ children, left, highlight, hint }) {
  return (
    <th
      scope="col"
      title={hint}
      className={`whitespace-nowrap px-3 py-2 font-medium ${left ? 'text-left' : 'text-right'} ${
        highlight ? 'bg-sky-50 text-slate-900' : 'text-slate-600'
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, muted, strong, tone, highlight }) {
  const toneClass = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-600' : '';
  return (
    <td
      className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
        muted ? 'text-slate-500' : toneClass || 'text-slate-800'
      } ${strong ? 'font-semibold' : ''} ${highlight ? 'bg-sky-50' : ''}`}
    >
      {children}
    </td>
  );
}
