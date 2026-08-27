/**
 * The colour ramp used by the exposure heatmap.
 *
 * ## Why viridis, and why it is not diverging
 *
 * Skylit's Heatseeker documentation describes positive exposure as "Green →
 * Yellow" and negative as "Blue → Purple", and says plainly that "the larger the
 * absolute value, the stronger the pull it exerts on price" — colour matters
 * less than magnitude.
 *
 * Reading their panels confirms the mechanism: the legend bar runs from the
 * panel's most negative value at deep purple to its most positive at yellow, in
 * one continuous viridis ramp. Zero is **not** pinned to the middle. In an SPXW
 * panel spanning -$13.9M to +$58.7M, zero sits about a fifth of the way along,
 * so small positives render dark blue rather than green, and only the genuinely
 * large positives reach green and yellow.
 *
 * That is the point. A diverging scale centred on zero shouts about sign; this
 * ramp shouts about magnitude, which is what actually moves price. The two
 * biggest nodes stand out and everything else recedes.
 *
 * The scale is computed **per panel**, since exposure magnitudes differ by
 * orders of magnitude between an index ETF and a small cap.
 */

// Viridis control points, evenly spaced from 0 to 1.
const VIRIDIS = [
  [68, 1, 84],     // #440154 deep purple — most negative in the panel
  [72, 40, 120],   // #482878
  [62, 74, 137],   // #3E4A89
  [49, 104, 142],  // #31688E indigo — where zero usually lands
  [38, 130, 142],  // #26828E
  [31, 158, 137],  // #1F9E89 teal
  [53, 183, 121],  // #35B779
  [109, 205, 89],  // #6DCD59 green
  [180, 222, 44],  // #B4DE2C
  [253, 231, 37],  // #FDE725 yellow — the King node
];

/** Viridis at position t in [0, 1]. */
export function viridis(t) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const scaled = clamped * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(scaled));
  const f = scaled - i;

  const a = VIRIDIS[i];
  const b = VIRIDIS[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export function viridisCss(t) {
  const [r, g, b] = viridis(t);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Position of `value` on a panel's scale. Linear across the full signed range,
 * which is what puts zero wherever it naturally falls rather than at the middle.
 */
export function scalePosition(value, min, max) {
  if (!Number.isFinite(value) || max === min) return 0;
  return (value - min) / (max - min);
}

/**
 * Readable text colour for a cell. Viridis is dark at the bottom and bright at
 * the top, so the switch happens around the green.
 */
export function textOn(t) {
  return t > 0.62 ? '#14261f' : '#ffffff';
}

/** Skylit quotes exposure in thousands: $58,710.0K rather than $58.7M. */
export function formatK(value) {
  if (!Number.isFinite(value)) return '—';
  const k = value / 1000;
  const sign = k < 0 ? '-' : '';
  const abs = Math.abs(k);
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}K`;
}

