/**
 * `composerIsDirty` — the one rule for whether a composer holds work worth keeping.
 *
 * @remarks
 * `ComposerShell` applies this rule to decide whether closing needs a prompt, and the draft
 * persistence hook applies it to decide whether a row is written. The two must agree, or a
 * composer could save a draft it would let close silently, or prompt about text it never saved.
 * Typed text counts; bare property picks do not, because a status or priority chosen on an empty
 * form is a default, not a draft.
 */

/** The text fields the rule reads. */
export interface ComposerDirtyInputs {
  readonly title: string;
  /** The one-line summary, for composers that have one. */
  readonly summary?: string | undefined;
  readonly body: string;
  /** Whether the record was already created, after which the text is no longer a draft. */
  readonly draftCommitted?: boolean | undefined;
}

/** Whether the composer holds typed text that has not become a record. */
export function composerIsDirty({
  title,
  summary,
  body,
  draftCommitted = false,
}: ComposerDirtyInputs): boolean {
  if (draftCommitted) return false;
  return title.trim().length > 0 || (summary ?? '').trim().length > 0 || body.trim().length > 0;
}
