/**
 * `@docket/ui/lib/browser-storage` — the one safe way to read and write `localStorage`.
 *
 * @remarks
 * Every surface that remembers a viewer's choice — which rail panel is open, whether the sidebar is
 * collapsed, how tall the Agenda's hours are — needs the same three defences, and each one had been
 * hand-rolled separately until this module existed:
 *
 * 1. **No `window`.** These components are server-rendered, so module and render code both run
 *    where there is no `Window` at all.
 * 2. **A `window` with no `localStorage`.** Not hypothetical: several of this repo's own test
 *    environments are exactly that, and a bare `typeof window === 'undefined'` guard sails straight
 *    past it into `Cannot read properties of undefined (reading 'getItem')`.
 * 3. **Storage that throws.** Safari private browsing and third-party-cookie blocking make the
 *    *property access itself* throw, before any method is called, and a full quota makes
 *    `setItem` throw. A remembered preference is never worth taking a surface down for.
 *
 * Every export therefore **returns rather than throws**, and every read resolves to `null` during
 * SSR so the first client paint hydrates against the real stored value. This mirrors
 * {@link file://./webauthn.ts}, whose exports are pure feature detection for the same reason.
 *
 * **Read these in an effect, not in a `useState` initializer.** React does not patch up attribute
 * mismatches it finds while hydrating, so an initializer returning the persisted value on the
 * client and the default on the server leaves the DOM stuck on whatever the server emitted — the
 * surface silently ignores the viewer's saved choice. Every caller here reads on mount instead.
 */

/**
 * The origin's `localStorage`, or `null` wherever there is not one to use.
 *
 * @remarks
 * Prefer the named helpers below. Reach for this only when a caller needs several operations to
 * see the same storage object, or an API the helpers do not wrap.
 *
 * @returns The live `Storage`, or `null` under SSR, a `window` without storage, or a browser that
 * refuses access.
 */
export function browserStorage(): Storage | null {
  try {
    // `'localStorage' in window`, not `window.localStorage ?? null`. TypeScript types the property
    // as always present, so the nullish fallback reads as dead code to
    // `@typescript-eslint/no-unnecessary-condition` — while at runtime the property is exactly what
    // can be missing. Presence is the thing being tested, so `in` is both the honest check and this
    // repo's documented feature-detection idiom.
    if (typeof window === 'undefined' || !('localStorage' in window)) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Read one stored string.
 *
 * @param key - The storage key.
 * @returns The stored string, or `null` when it is unset or unreachable. The two are deliberately
 * indistinguishable: a caller that cannot reach storage is in exactly the position of one that has
 * never stored anything, and both want the same fallback.
 */
export function readStoredString(key: string): string | null {
  try {
    return browserStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * Read one stored integer.
 *
 * @param key - The storage key.
 * @returns The parsed integer, or `null` when it is unset, unreachable, or not a finite number.
 * Callers still own **range**: this says the value is a number, not that it is a legal one, so a
 * clamp on the way out is still the caller's job.
 *
 * @example
 * ```ts
 * const stored = readStoredInteger('docket.rail.agenda.scale');
 * const scale = stored === null ? DEFAULT : clampPixelsPerHour(stored);
 * ```
 */
export function readStoredInteger(key: string): number | null {
  const raw = readStoredString(key);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read one stored boolean, written by {@link writeStoredValue} as `'1'` or `'0'`.
 *
 * @param key - The storage key.
 * @returns `true` for `'1'`, `false` for any other stored string, and `null` when it is unset or
 * unreachable — so a caller can tell "the viewer chose false" from "the viewer has not chosen",
 * which is the difference between honouring a preference and applying a default.
 */
export function readStoredBoolean(key: string): boolean | null {
  const raw = readStoredString(key);
  return raw === null ? null : raw === '1';
}

/**
 * Write one value, doing nothing where there is nowhere to write it.
 *
 * @param key - The storage key.
 * @param value - A string, or a boolean stored as `'1'` / `'0'` for {@link readStoredBoolean}, or a
 * number stored in base 10 for {@link readStoredInteger}.
 */
export function writeStoredValue(key: string, value: string | number | boolean): void {
  const encoded =
    typeof value === 'boolean'
      ? value
        ? '1'
        : '0'
      : typeof value === 'number'
        ? String(value)
        : value;
  try {
    browserStorage()?.setItem(key, encoded);
  } catch {
    /* A preference that cannot be remembered is not an error worth surfacing. */
  }
}

/**
 * Remove one stored value, doing nothing where there is nothing to remove it from.
 *
 * @param key - The storage key.
 */
export function clearStoredValue(key: string): void {
  try {
    browserStorage()?.removeItem(key);
  } catch {
    /* See {@link writeStoredValue}. */
  }
}
