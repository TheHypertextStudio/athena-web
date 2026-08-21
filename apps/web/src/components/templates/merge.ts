/**
 * Like `Partial<T>`, but a present key may also hold `undefined` explicitly.
 *
 * @remarks
 * `Partial<T>` only makes keys optional; under `exactOptionalPropertyTypes` it still rejects an
 * explicit `undefined` value for a key that is present. Template patches are built by widening
 * scripts that produce exactly that shape, so {@link templateMerge} needs this instead.
 */
type PartialWithUndefined<T> = { [K in keyof T]?: T[K] | undefined };

/** How an authored value absorbs a template's fields. */
export interface TemplateMergeRule<T> {
  /** The long-form Markdown field, which appends rather than replacing authored text. */
  readonly document?: keyof T;
  /** Single-line fields that a template fills only while they remain blank. */
  readonly labels?: readonly (keyof T)[];
}

/** Whether an authored field still contains no meaningful value. */
function isBlank(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length === 0 : value === null;
}

/**
 * Merge template fields without removing authored text.
 *
 * @remarks
 * Document fields append with a blank line, label fields fill only while blank, and structured
 * properties are replaced because their controls keep the choice visible and easy to change.
 * Both create composers and persisted editors use this policy so applying a template has one
 * ownership boundary and one data-preservation invariant.
 *
 * @param current - The authored value as it stands.
 * @param patch - The fields supplied by the selected template.
 * @param rule - The document and single-line fields that require preservation behavior.
 * @returns the patch to merge, with document and label fields resolved against `current`.
 */
export function templateMerge<T extends object>(
  current: T,
  patch: PartialWithUndefined<T>,
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
