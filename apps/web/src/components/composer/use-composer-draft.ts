'use client';

/**
 * One create composer's field state, held as a single draft value.
 *
 * @remarks
 * Every composer used to own eight to thirteen separate `useState` calls. That is fine while the
 * only writer is a picker setting one field, and it breaks the moment a template has to set all
 * of them at once: thirteen setter calls are thirteen chances to forget one.
 *
 * State lives here rather than in `ComposerShell` because the shell is presentational and every
 * composer's field set differs. It also means `withComposerReset` keeps working untouched: the
 * HOC remounts the composer on each open, and this hook's state goes with it.
 */
import { useCallback, useMemo, useState } from 'react';

/** The value {@link useComposerDraft} returns. */
export interface ComposerDraft<T extends object> {
  /** The current field values. */
  readonly draft: T;
  /** Set one field. Stable across renders, so pickers may take it directly. */
  readonly setField: <K extends keyof T>(key: K, value: T[K]) => void;
  /**
   * Merge a patch derived from the current draft.
   *
   * @remarks
   * Passing a recipe rather than a value keeps a caller's effect from having to depend on the
   * field it reads, which would make the effect re-run on every keystroke that touches it. Used
   * both for derived defaults (the task composer filling in a team's first workflow state) and
   * for applying the template domain's merge policy.
   */
  readonly updateDraft: (recipe: (current: T) => Partial<T>) => void;
}

/**
 * Hold a create composer's fields as one draft value.
 *
 * @param initial - The starting field values, read once on mount.
 * @returns the {@link ComposerDraft} handle.
 *
 * @example
 * ```tsx
 * const { draft, setField } = useComposerDraft({ name: '', priority: 'none' });
 * <EnumPicker value={draft.priority} onChange={(next) => setField('priority', next ?? 'none')} />
 * ```
 */
export function useComposerDraft<T extends object>(initial: T): ComposerDraft<T> {
  const [draft, setDraft] = useState<T>(initial);

  const setField = useCallback(<K extends keyof T>(key: K, value: T[K]): void => {
    setDraft((current) =>
      Object.is(current[key], value) ? current : { ...current, [key]: value },
    );
  }, []);

  const updateDraft = useCallback((recipe: (current: T) => Partial<T>): void => {
    setDraft((current) => {
      const patch = recipe(current);
      // Returning `current` unchanged is load-bearing, not an optimisation. A composer calls this
      // from an effect that fills in a derived default ("the team's first workflow state, if the
      // status is still unset"), and that effect's dependencies include values which are rebuilt
      // each render. Minting a fresh draft object for a patch that changes nothing would make the
      // effect re-run forever.
      const keys = Object.keys(patch) as (keyof T)[];
      if (keys.every((key) => Object.is(current[key], patch[key]))) return current;
      return { ...current, ...patch };
    });
  }, []);

  return useMemo(() => ({ draft, setField, updateDraft }), [draft, setField, updateDraft]);
}
