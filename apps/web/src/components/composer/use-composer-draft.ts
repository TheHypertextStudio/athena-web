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
   * for applying a template through {@link templateMerge}.
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

/** How a composer's fields absorb a template's, per {@link templateMerge}. */
export interface TemplateMergeRule<T> {
  /**
   * The long-form markdown field. A template's body is **appended** to whatever is there, never
   * substituted for it.
   */
  readonly document?: keyof T;
  /**
   * The single-line text fields (a title, a one-sentence summary). Filled only while empty —
   * appending to a title produces nonsense, and overwriting one would discard typed words.
   */
  readonly labels?: readonly (keyof T)[];
}

/** Whether a draft field currently holds nothing a person typed. */
function isBlank(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length === 0 : value === null;
}

/**
 * Merge a template's fields into a draft without removing anything the author wrote.
 *
 * @remarks
 * This is the whole contract of applying a template, and it is the fix for the defect this slice
 * exists to remove. The old initiative picker called `setBody(GUIDED_DOCUMENT)` on every click and
 * destroyed typed text; the answer is not a confirmation prompt or an undo affordance, it is for
 * the action to take nothing away in the first place.
 *
 * Three behaviours, one per kind of field:
 *
 * | Field | Behaviour | Why |
 * | --- | --- | --- |
 * | `document` | appended, separated by a blank line | Two outlines stacked is a readable document; a replaced one is lost work. |
 * | `labels` | filled only while blank | A title cannot be appended to, and overwriting one discards typed words. |
 * | everything else | set | Enums and dates show in the property strip and are one click to change, so nothing written is at risk. |
 *
 * Because nothing is destroyed, applying is repeatable and needs no undo: a second template adds
 * a second outline, and a template picked by mistake is deleted the way any other text is.
 *
 * @param current - The draft as it stands.
 * @param patch - The template's fields, already narrowed to this composer's kind.
 * @param rule - Which field is the document and which are single-line labels.
 * @returns the patch to merge, with the document and label fields resolved against `current`.
 */
export function templateMerge<T extends object>(
  current: T,
  patch: Partial<T>,
  rule: TemplateMergeRule<T>,
): Partial<T> {
  const merged: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const incoming = patch[key];
    if (incoming === undefined) continue;

    if (key === rule.document && typeof incoming === 'string') {
      const existing = current[key];
      const existingText = typeof existing === 'string' ? existing.trim() : '';
      merged[key] = (
        existingText.length === 0 ? incoming : `${existingText}\n\n${incoming}`
      ) as T[typeof key];
      continue;
    }

    if (rule.labels?.includes(key)) {
      if (isBlank(current[key])) merged[key] = incoming;
      continue;
    }

    merged[key] = incoming;
  }
  return merged;
}
