'use client';

/**
 * `useDebouncedAutosave` — persist a form value automatically once the user stops editing.
 *
 * @remarks
 * The seam behind our banned "click Save to save" flow for editing existing data. Instead of a
 * Save button, a surface holds the field(s) in local draft state (for instant UI feedback) and
 * hands that draft plus the persisted server value to this hook. When the draft diverges from what
 * is saved, the hook fires the same mutation a Save button would after `delayMs` of quiet, so
 * toggles/selects feel immediate and range sliders don't save on every intermediate tick.
 *
 * The dirty guard is built in: the hook never fires on mount, never fires while the value already
 * equals the persisted baseline, and never fires before the baseline has loaded. Comparison is by
 * canonical serialization (object keys sorted), so a value that reaches the same shape by a
 * different edit path — e.g. a record whose keys were reordered — is still recognized as unchanged
 * and does not trigger a redundant write or an autosave loop after the query refetches.
 */
import { useEffect, useRef } from 'react';

/**
 * Serialize a value so two structurally-equal values compare equal regardless of object key order.
 *
 * @param input - Any JSON-serializable value.
 * @returns A stable string key for equality comparison.
 */
function canonicalize(input: unknown): string {
  return JSON.stringify(input ?? null, (_key, value: unknown) => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const source = value as Record<string, unknown>;
      return Object.keys(source)
        .sort()
        .reduce<Record<string, unknown>>((sorted, key) => {
          sorted[key] = source[key];
          return sorted;
        }, {});
    }
    return value;
  });
}

/** Inputs for {@link useDebouncedAutosave}. */
export interface DebouncedAutosaveOptions<T> {
  /** The current draft value the user is editing. */
  value: T;
  /** The persisted server value to diff against; `undefined` until it has loaded. */
  baseline: T | undefined;
  /** The write to run when the draft is dirty — typically a {@link useApiMutation} `mutate`. */
  save: (value: T) => void;
  /** Gate that must be true before any autosave fires (e.g. the query has settled). Default `true`. */
  ready?: boolean;
  /** Quiet period in milliseconds before persisting. Default `600`. */
  delayMs?: number;
}

/**
 * Autosave a draft value on a debounce, only when it actually differs from the persisted baseline.
 *
 * @typeParam T - The shape of the value being edited.
 * @param options - See {@link DebouncedAutosaveOptions}.
 *
 * @example
 * ```typescript
 * useDebouncedAutosave({
 *   value: draft,
 *   baseline: persisted,
 *   ready: query.isSuccess,
 *   save: (next) => mutation.mutate(next),
 * });
 * ```
 */
export function useDebouncedAutosave<T>(options: DebouncedAutosaveOptions<T>): void {
  const { value, baseline, save, ready = true, delayMs = 600 } = options;

  // Latest value/save read at fire time so the effect can key only on primitive snapshots.
  const latest = useRef({ value, save });
  latest.current = { value, save };

  const valueKey = canonicalize(value);
  const baselineKey = canonicalize(baseline);
  const hasBaseline = baseline !== undefined;

  useEffect(() => {
    if (!ready || !hasBaseline || valueKey === baselineKey) return;
    const handle = setTimeout(() => {
      latest.current.save(latest.current.value);
    }, delayMs);
    return () => {
      clearTimeout(handle);
    };
  }, [valueKey, baselineKey, hasBaseline, ready, delayMs]);
}
