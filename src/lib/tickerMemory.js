/**
 * The ticker the user is currently looking at, remembered across pages.
 *
 * Moving from the simulator to the insights page almost always means "same
 * company, different question", so re-typing the ticker on every hop is pure
 * friction. Each page seeds itself from here when its own URL does not name a
 * ticker.
 *
 * Precedence is deliberate and always the same: **an explicit ticker in the URL
 * wins.** A shared link must show what the sender saw, never whatever the
 * recipient happened to be looking at a moment earlier.
 *
 * Stored in sessionStorage rather than localStorage: it should survive
 * navigation and a refresh within the tab, but a new session should start
 * clean rather than resurrect a ticker from last week. Access is wrapped
 * because storage throws in private-mode Safari and when cookies are blocked,
 * and a memory aid is never worth breaking the page over.
 */

const KEY = 'gammalift:last-ticker';

// Survives even when sessionStorage is unavailable, so the feature still works
// within a single page session.
let fallback = '';

export function getLastTicker() {
  try {
    return window.sessionStorage.getItem(KEY) || fallback || '';
  } catch {
    return fallback || '';
  }
}

export function setLastTicker(symbol) {
  const value = String(symbol || '').trim().toUpperCase();
  if (!value) return;

  fallback = value;
  try {
    window.sessionStorage.setItem(KEY, value);
  } catch {
    // Ignored on purpose: the in-memory fallback above already holds it.
  }
}
