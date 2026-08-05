'use client';

/**
 * One create composer's field state, held as a single draft value.
 *
 * @remarks
 * Every composer used to own eight to thirteen separate `useState` calls. That is fine while the
 * only writer is a picker setting one field, and it breaks the moment a template has to set all
 * of them at once: thirteen setter calls are thirteen chances to forget one, and there is nothing
 * to snapshot when the user wants that action back.
 *
 * Holding the fields as one object fixes both. A template applies as a merge, and undo is a
 * single assignment of the value that was there a moment ago.
 *
 * State lives here rather than in `ComposerShell` because the shell is presentational and every
 * composer's field set differs. It also means `withComposerReset` keeps working untouched: the
 * HOC remounts the composer on each open, and this hook's state goes with it.
 */
import { useCallback, useMemo, useState } from 'react';

/** The template currently applied to a draft, for the composer's undo affordance. */
export interface AppliedTemplate {
  /** The template's id, so the picker can mark the applied row. */
  readonly id: string;
  /** The template's name, shown in the picker trigger and the applied notice. */
  readonly name: string;
}

/** The value {@link useComposerDraft} returns. */
export interface ComposerDraft<T extends object> {
  /** The current field values. */
  readonly draft: T;
  /** Set one field. Stable across renders, so pickers may take it directly. */
  readonly setField: <K extends keyof T>(key: K, value: T[K]) => void;
  /**
   * Merge a patch derived from the current draft, without arming the undo.
   *
   * @remarks
   * For the composer's own derived defaults — the task composer filling in a team's first workflow
   * state once the team resolves, say. Passing a recipe rather than a value keeps the caller's
   * effect from having to depend on the field it reads, which would make the effect re-run on
   * every keystroke that touches it.
   */
  readonly updateDraft: (recipe: (current: T) => Partial<T>) => void;
  /**
   * Merge a template's fields into the draft and arm the undo.
   *
   * @remarks
   * A merge, not a replacement: a template asserts only the fields it names, so a title the
   * author already typed survives a template that does not mention titles. This is what makes
   * the action safe to take mid-draft, which the previous implementation was not — it overwrote
   * the description unconditionally and offered no way back.
   */
  readonly applyTemplate: (patch: Partial<T>, template: AppliedTemplate) => void;
  /** Restore the draft to the instant before the last {@link ComposerDraft.applyTemplate}. */
  readonly undoTemplate: () => void;
  /** The template applied by the last apply, or null. */
  readonly appliedTemplate: AppliedTemplate | null;
}

/**
 * The three values that move together on every apply and undo.
 *
 * @remarks
 * One state, not three, so an apply is a single transition. Splitting them would put a
 * `setBeforeApply` call inside a `setDraft` updater — a side effect in a function React is free
 * to call twice.
 */
interface DraftState<T extends object> {
  readonly draft: T;
  /** The draft as it stood immediately before the last apply; null when nothing is undoable. */
  readonly beforeApply: T | null;
  readonly applied: AppliedTemplate | null;
}

/**
 * Hold a create composer's fields as one draft value.
 *
 * @param initial - The starting field values, read once on mount.
 * @returns the {@link ComposerDraft} handle.
 *
 * @example
 * ```tsx
 * const { draft, setField, applyTemplate } = useComposerDraft({ name: '', priority: 'none' });
 * <EnumPicker value={draft.priority} onChange={(next) => setField('priority', next ?? 'none')} />
 * ```
 */
export function useComposerDraft<T extends object>(initial: T): ComposerDraft<T> {
  const [state, setState] = useState<DraftState<T>>({
    draft: initial,
    beforeApply: null,
    applied: null,
  });

  const setField = useCallback(<K extends keyof T>(key: K, value: T[K]): void => {
    setState((current) =>
      Object.is(current.draft[key], value)
        ? current
        : { ...current, draft: { ...current.draft, [key]: value } },
    );
  }, []);

  const updateDraft = useCallback((recipe: (current: T) => Partial<T>): void => {
    setState((current) => {
      const patch = recipe(current.draft);
      // Returning `current` unchanged is load-bearing, not an optimisation. A composer calls this
      // from an effect that fills in a derived default ("the team's first workflow state, if the
      // status is still unset"), and that effect's dependencies include values which are rebuilt
      // each render. Minting a fresh draft object for a patch that changes nothing would make the
      // effect re-run forever.
      const keys = Object.keys(patch) as (keyof T)[];
      if (keys.every((key) => Object.is(current.draft[key], patch[key]))) return current;
      return { ...current, draft: { ...current.draft, ...patch } };
    });
  }, []);

  const applyTemplate = useCallback((patch: Partial<T>, template: AppliedTemplate): void => {
    setState((current) => ({
      draft: { ...current.draft, ...patch },
      // Undo is one step on purpose: it returns what was on screen when the button was pressed,
      // which is the only thing a control labelled "Undo" can promise without asking the user to
      // reconstruct a history in their head.
      beforeApply: current.draft,
      applied: template,
    }));
  }, []);

  const undoTemplate = useCallback((): void => {
    setState((current) =>
      current.beforeApply
        ? { draft: current.beforeApply, beforeApply: null, applied: null }
        : { ...current, applied: null },
    );
  }, []);

  return useMemo(
    () => ({
      draft: state.draft,
      setField,
      updateDraft,
      applyTemplate,
      undoTemplate,
      appliedTemplate: state.applied,
    }),
    [state.draft, state.applied, setField, updateDraft, applyTemplate, undoTemplate],
  );
}
