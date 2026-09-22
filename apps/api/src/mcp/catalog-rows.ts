/**
 * `@docket/api` — the report rows and diff lines shared by `update`, `define_labels` and
 * `define_template`.
 *
 * @remarks
 * All three answer on the change-report card. A catalog row differs from a work row in one way:
 * the card cannot tell a label from a label group by the call's `entity`, so every row carries its
 * own `kind`, and a `note` that says where the row lives ("Severity group · Core") because two
 * labels called Bug in different teams are otherwise the same line.
 */
import { z } from 'zod';

import { ApiError } from '../error';
import { describeApiError } from './result';

/** The catalog kinds these tools write. */
export const CATALOG_KINDS = ['label', 'label_group', 'template'] as const;

/** One catalog kind. */
export type CatalogKind = (typeof CATALOG_KINDS)[number];

/** One field that moved, as the card renders it. */
export interface FieldDiff {
  readonly field: string;
  readonly from: string;
  readonly to: string;
}

/** One row the tool wrote or matched. */
export interface CatalogRow {
  readonly kind: CatalogKind;
  readonly id: string;
  readonly title: string;
  readonly href: string;
  /** Where the row lives, and whether it is new. */
  readonly note: string;
  /** True when the entry already matched and nothing was written. */
  readonly matched: boolean;
  readonly fields: FieldDiff[];
}

/** One entry the tool left alone. */
export interface CatalogSkip {
  readonly kind: CatalogKind;
  readonly title: string;
  readonly reason: string;
  /** The error's code and failing fields, for the caller to correct its arguments. */
  readonly detail: string;
}

/** The output schema for a catalog row. */
export const CatalogRowSchema = z.object({
  kind: z.enum(CATALOG_KINDS),
  id: z.string(),
  title: z.string(),
  href: z.string().describe('Where it can be managed in the product app.'),
  note: z.string().describe('Where it lives, and whether this call created it.'),
  matched: z.boolean().describe('True when it already matched and nothing was written.'),
  fields: z
    .array(z.object({ field: z.string(), from: z.string(), to: z.string() }))
    .describe('What moved, as before → after. Empty on a create or a match.'),
});

/** The output schema for a skipped entry. */
export const CatalogSkipSchema = z.object({
  kind: z.enum(CATALOG_KINDS),
  title: z.string(),
  reason: z
    .string()
    .describe(
      '`not_permitted` (renaming or regrouping labels, and any group change, needs manage access), `conflict` (the name is taken, or the label and its group are in different teams), `not_found`, or `validation_error`.',
    ),
  detail: z.string().describe('The failing code and fields, to correct the entry and retry.'),
});

/**
 * Turn a refused entry into a skipped row.
 *
 * @remarks
 * One bad entry must not undo the good ones before it, which would already have committed, so a
 * domain error becomes a row the caller can read and act on. Anything else is a real failure.
 *
 * @throws The original error when it is not an {@link ApiError}.
 */
export function skipFor(kind: CatalogKind, title: string, err: unknown): CatalogSkip {
  if (!(err instanceof ApiError)) throw err;
  const reason = err.code === 'forbidden' ? 'not_permitted' : err.code;
  return { kind, title, reason, detail: describeApiError(err) };
}

/** An id's display name from a lookup, or `unset` when the value is not an id. */
export function nameOf(names: ReadonlyMap<string, string>, value: unknown, unset: string): string {
  return typeof value === 'string' ? (names.get(value) ?? value) : unset;
}

/**
 * The longest a single side of a diff line may be.
 *
 * @remarks
 * A diff line says what moved; it is not the payload that moved. Editing a description used to put
 * the entire old text and the entire new text into one row, which broke the report card's layout
 * and cost the model as much context as re-reading the entity would have.
 */
const DISPLAY_LIMIT = 200;

/** Shorten one rendered value, marking the cut so nobody reads a truncation as the whole value. */
function clamp(text: string): string {
  return text.length > DISPLAY_LIMIT ? text.slice(0, DISPLAY_LIMIT - 1).trimEnd() + '…' : text;
}

/**
 * The fields that moved between two snapshots, as lines a person can check.
 *
 * @remarks
 * Values are compared whole and cut only for display. Clamping before the comparison once made any
 * edit past the limit invisible: two long descriptions sharing their first 199 characters compared
 * equal, the write landed with nothing recorded, and `undo` had nothing to reverse.
 *
 * @param before - The row before the write.
 * @param after - The row after it; its keys decide which fields are compared.
 * @param show - Renders one field's value losslessly, or returns undefined to leave it out.
 */
export function fieldDiffs(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  show: (field: string, value: unknown) => string | undefined,
): FieldDiff[] {
  return Object.keys(after).flatMap((field) => {
    const from = show(field, before[field]);
    const to = show(field, after[field]);
    if (from === undefined || to === undefined || from === to) return [];
    return [{ field, from: clamp(from), to: clamp(to) }];
  });
}
