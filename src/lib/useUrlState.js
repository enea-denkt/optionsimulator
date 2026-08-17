import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Keeps a state object mirrored in the query string, so any view can be shared
 * or bookmarked by copying the address bar.
 *
 * Three decisions worth knowing about:
 *
 *   - **Defaults are omitted.** A parameter only appears once it differs from
 *     the default, so an untouched page keeps a clean URL and a shared link
 *     carries only what was actually changed.
 *   - **Writes replace rather than push.** Dragging a slider fires dozens of
 *     updates; pushing each one would bury the previous page under history
 *     entries and make the back button useless.
 *   - **The URL is read once, on mount.** After that this hook owns the value.
 *     Re-reading would fight its own writes, and with replace-only history there
 *     is nothing to navigate back to.
 *
 * Keys absent from `spec` are held in state but never written to the URL, which
 * is how derived or bulky values stay out of it.
 */

export const asString = (fallback = '') => ({
  parse: (raw) => raw,
  format: (value) => String(value ?? ''),
  fallback,
});

export const asNumber = (fallback = 0) => ({
  parse: (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  },
  // Trims float noise: 0.30000000000000004 has no business in a shared link.
  format: (value) => String(Math.round(Number(value) * 1e6) / 1e6),
  fallback,
});

export const asBoolean = (fallback = false) => ({
  parse: (raw) => raw === '1' || raw === 'true',
  format: (value) => (value ? '1' : '0'),
  fallback,
});

/** Number that may legitimately be null (an optional input left blank). */
export const asNullableNumber = (fallback = null) => ({
  parse: (raw) => {
    if (raw === '' || raw === 'null') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  },
  format: (value) => (value === null || value === undefined ? '' : String(value)),
  fallback,
});

/** One of a fixed set; anything else falls back rather than poisoning state. */
export const asEnum = (values, fallback) => ({
  parse: (raw) => (values.includes(raw) ? raw : undefined),
  format: (value) => String(value),
  fallback,
});

/**
 * URL -> state. Exported so the round trip can be tested without a renderer.
 */
export function hydrateFromParams(spec, defaults, searchParams, initial = null) {
  // `initial` seeds values the URL does not name — a ticker carried over from
  // another page, for instance. It is layered under the URL, never over it, so
  // an explicit parameter always wins.
  //
  // Note it is kept separate from `defaults`: omission from the URL is judged
  // against `defaults`, so a seeded value still gets written out and a link
  // copied from the address bar carries it.
  const next = { ...defaults, ...(initial || {}) };

  for (const [key, codec] of Object.entries(spec)) {
    const param = codec.param || key;
    if (!searchParams.has(param)) continue;

    const parsed = codec.parse(searchParams.get(param));
    // undefined means the value was unusable — keep the default instead of
    // letting a hand-edited URL push NaN into the app.
    if (parsed !== undefined) next[key] = parsed;
  }

  return next;
}

/**
 * state -> URL. Mutates a copy of `current`, so query parameters belonging to
 * anything else survive untouched.
 */
export function serializeToParams(spec, defaults, state, current = new URLSearchParams()) {
  const next = new URLSearchParams(current);

  for (const [key, codec] of Object.entries(spec)) {
    const param = codec.param || key;
    const value = state[key];
    const fallback = codec.fallback !== undefined ? codec.fallback : defaults[key];

    if (value === undefined || sameValue(value, fallback)) next.delete(param);
    else next.set(param, codec.format(value));
  }

  return next;
}

function sameValue(a, b) {
  if (a === b) return true;
  // Numbers arriving from a URL are re-parsed, so compare loosely enough that
  // "90" and 90 do not look like a change worth writing.
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return false;
}

/**
 * @param spec     {key: codec} for the keys that belong in the URL
 * @param defaults the full initial state, including keys outside the spec
 * @param options  `debounceMs` throttles writes while a slider is moving;
 *                 `initial` seeds keys the URL does not name (read once, on
 *                 mount) without affecting which values are omitted from it
 */
export function useUrlState(spec, defaults, { debounceMs = 200, initial = null } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();

  // The URL is authoritative only for the first render; see the note above.
  const initialParams = useRef(searchParams);
  const seed = useRef(initial);
  const [state, setState] = useState(() =>
    hydrateFromParams(spec, defaults, initialParams.current, seed.current));

  const timer = useRef(null);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);

    timer.current = setTimeout(() => {
      setSearchParams(
        (current) => serializeToParams(spec, defaults, latest.current, current),
        { replace: true },
      );
    }, debounceMs);

    return () => clearTimeout(timer.current);
    // `defaults` and `spec` are module constants at every call site; including
    // them would re-run this on each render for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, debounceMs, setSearchParams]);

  const update = useCallback((next) => {
    setState((prev) => (typeof next === 'function' ? next(prev) : next));
  }, []);

  return [state, update];
}
