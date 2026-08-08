/**
 * `@docket/ui/lib/browser-storage` — the one safe way to read and write Web Storage.
 *
 * @remarks
 * Every surface that remembers a viewer's choice — which rail panel is open, whether the sidebar is
 * collapsed, how tall the Agenda's hours are, which document tabs were open — needs the same three
 * defences, and each one had been hand-rolled separately until this module existed:
 *
 * 1. **No `window`.** These components are server-rendered, so module and render code both run
 *    where there is no `Window` at all.
 * 2. **A `window` with no storage on it.** Not hypothetical: several of this repo's own test
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
 *
 * What this module deliberately does **not** do is validate. A read tells you a value was there and
 * had the right primitive shape; whether it is *legal* — a density that is one of the three named
 * ones, a zoom inside its clamp, a tab whose ids are ULIDs — stays with the caller that owns the
 * meaning. Storage is the one input a user can hand-edit, and every one of these keys long outlives
 * the build that wrote it.
 */

/**
 * Which of the two Web Storage areas a key lives in.
 *
 * @remarks
 * `local` survives browser restarts and is where preferences belong. `session` dies with the tab
 * and is where per-tab working state belongs, such as the open-documents set — those are the tabs
 * *this* window had open, and restoring them into a different one would be wrong.
 */
export type BrowserStorageArea = 'local' | 'session';

/**
 * One storage area, or `null` wherever there is not one to use.
 *
 * @remarks
 * Prefer the named helpers below. Reach for this only when a caller needs several operations to
 * see the same storage object, or an API the helpers do not wrap.
 *
 * @param area - Which area to open. Defaults to `local`.
 * @returns The live `Storage`, or `null` under SSR, a `window` without it, or a browser that
 * refuses access.
 */
export function browserStorage(area: BrowserStorageArea = 'local'): Storage | null {
  const property = area === 'local' ? 'localStorage' : 'sessionStorage';
  try {
    // `property in window`, not `window[property] ?? null`. TypeScript types both properties as
    // always present, so a nullish fallback reads as dead code to
    // `@typescript-eslint/no-unnecessary-condition` — while at runtime their presence is exactly
    // what varies. Presence is the thing being tested, so `in` is both the honest check and this
    // repo's documented feature-detection idiom.
    if (typeof window === 'undefined' || !(property in window)) return null;
    return window[property];
  } catch {
    return null;
  }
}

/**
 * Read one stored string.
 *
 * @param key - The storage key.
 * @param area - Which area to read. Defaults to `local`.
 * @returns The stored string, or `null` when it is unset or unreachable. The two are deliberately
 * indistinguishable: a caller that cannot reach storage is in exactly the position of one that has
 * never stored anything, and both want the same fallback.
 */
export function readStoredString(key: string, area: BrowserStorageArea = 'local'): string | null {
  try {
    return browserStorage(area)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * Read one stored integer.
 *
 * @param key - The storage key.
 * @param area - Which area to read. Defaults to `local`.
 * @returns The parsed integer, or `null` when it is unset, unreachable, or not a finite number.
 * Callers still own **range**: this says the value is a number, not that it is a legal one.
 *
 * @example
 * ```ts
 * const stored = readStoredInteger('docket.rail.agenda.scale');
 * const scale = stored === null ? DEFAULT : clampPixelsPerHour(stored);
 * ```
 */
export function readStoredInteger(key: string, area: BrowserStorageArea = 'local'): number | null {
  const raw = readStoredString(key, area);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read one stored boolean, written by {@link writeStoredValue} as `'1'` or `'0'`.
 *
 * @param key - The storage key.
 * @param area - Which area to read. Defaults to `local`.
 * @returns `true` for `'1'`, `false` for any other stored string, and `null` when it is unset or
 * unreachable — so a caller can tell "the viewer chose false" from "the viewer has not chosen",
 * which is the difference between honouring a preference and applying a default.
 */
export function readStoredBoolean(key: string, area: BrowserStorageArea = 'local'): boolean | null {
  const raw = readStoredString(key, area);
  return raw === null ? null : raw === '1';
}

/**
 * Read and parse one stored JSON value.
 *
 * @param key - The storage key.
 * @param area - Which area to read. Defaults to `local`.
 * @returns The parsed value as `unknown`, or `null` when it is unset, unreachable, or not valid
 * JSON.
 *
 * @remarks
 * `unknown`, never a caller-supplied generic. A generic here would be a cast wearing a type
 * parameter: it would claim the stored bytes match a shape this module never checked, on the one
 * input a user can hand-edit. Callers narrow it with the predicate they already own.
 *
 * @example
 * ```ts
 * const parsed = readStoredJson(STORAGE_KEY);
 * if (!isSnapshot(parsed)) return null;
 * ```
 */
export function readStoredJson(key: string, area: BrowserStorageArea = 'local'): unknown {
  const raw = readStoredString(key, area);
  if (raw === null || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write one value, doing nothing where there is nowhere to write it.
 *
 * @param key - The storage key.
 * @param value - A string, or a boolean stored as `'1'` / `'0'` for {@link readStoredBoolean}, or a
 * number stored in base 10 for {@link readStoredInteger}.
 * @param area - Which area to write. Defaults to `local`.
 */
export function writeStoredValue(
  key: string,
  value: string | number | boolean,
  area: BrowserStorageArea = 'local',
): void {
  const encoded =
    typeof value === 'boolean'
      ? value
        ? '1'
        : '0'
      : typeof value === 'number'
        ? String(value)
        : value;
  try {
    browserStorage(area)?.setItem(key, encoded);
  } catch {
    /* A preference that cannot be remembered is not an error worth surfacing. */
  }
}

/**
 * Serialize and write one JSON value, doing nothing where there is nowhere to write it.
 *
 * @param key - The storage key.
 * @param value - Any JSON-serializable value.
 * @param area - Which area to write. Defaults to `local`.
 *
 * @remarks
 * A value containing a cycle makes `JSON.stringify` throw, which is caught here alongside quota —
 * the caller's job was to hand over its state, not to prove the serializer accepts it.
 */
export function writeStoredJson(
  key: string,
  value: unknown,
  area: BrowserStorageArea = 'local',
): void {
  try {
    browserStorage(area)?.setItem(key, JSON.stringify(value));
  } catch {
    /* See {@link writeStoredValue}. */
  }
}

/**
 * Remove one stored value, doing nothing where there is nothing to remove it from.
 *
 * @param key - The storage key.
 * @param area - Which area to clear. Defaults to `local`.
 */
export function clearStoredValue(key: string, area: BrowserStorageArea = 'local'): void {
  try {
    browserStorage(area)?.removeItem(key);
  } catch {
    /* See {@link writeStoredValue}. */
  }
}
