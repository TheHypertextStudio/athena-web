/**
 * `@docket/api` — the report rows shared by `define_labels` and `define_template`.
 *
 * @remarks
 * Both tools answer on the change-report card. A catalog row differs from a work row in one way:
 * the card cannot tell a label from a label group by the call's `entity`, so every row carries its
 * own `kind`, and a `note` that says where the row lives ("Severity group · Core") because two
 * labels called Bug in different teams are otherwise the same line.
 */
import { z } from 'zod';

import { ApiError } from '../error';
import { describeApiError } from './result';

/** The catalog kinds these tools write. */
export type CatalogRowKind = 'label' | 'label_group' | 'template';

/** One field that moved, as the card renders it. */
export interface FieldDiff {
  readonly field: string;
  readonly from: string;
  readonly to: string;
}

/** One row the tool wrote or matched. */
export interface CatalogRow {
  readonly kind: CatalogRowKind;
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
  readonly kind: CatalogRowKind;
  readonly id: string | null;
  readonly title: string;
  readonly reason: string;
  /** The error's code and failing fields, for the caller to correct its arguments. */
  readonly detail: string;
}

/** The output schema for a catalog row. */
export const CatalogRowSchema = z.object({
  kind: z.enum(['label', 'label_group', 'template']),
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
  kind: z.enum(['label', 'label_group', 'template']),
  id: z.string().nullable(),
  title: z.string(),
  reason: z
    .string()
    .describe(
      '`not_permitted` (renaming or regrouping labels, and any group change, needs manage access), `conflict` (the name is taken, or the label and its group are in different teams), `not_found`, or `validation_error`.',
    ),
  detail: z.string().describe('The failing code and fields, to correct the entry and retry.'),
});

/** The settings page that manages each catalog kind. */
const SETTINGS = {
  label: 'labels',
  label_group: 'labels',
  template: 'templates',
} as const satisfies Record<CatalogRowKind, string>;

/**
 * The product page where a catalog row is managed.
 *
 * @remarks
 * Labels and templates have no page of their own, so every row opens its settings list.
 */
export function catalogHref(orgId: string, kind: CatalogRowKind): string {
  return `/orgs/${orgId}/settings/${SETTINGS[kind]}`;
}

/**
 * Turn a refused entry into a skipped row.
 *
 * @remarks
 * One bad entry must not undo the good ones before it, which would already have committed, so a
 * domain error becomes a row the caller can read and act on. Anything else is a real failure.
 *
 * @throws The original error when it is not an {@link ApiError}.
 */
export function skipFor(
  kind: CatalogRowKind,
  id: string | null,
  title: string,
  err: unknown,
): CatalogSkip {
  if (!(err instanceof ApiError)) throw err;
  const reason = err.code === 'forbidden' ? 'not_permitted' : err.code;
  return { kind, id, title, reason, detail: describeApiError(err) };
}

/**
 * The fields that moved between two snapshots.
 *
 * @param before - The row before the write.
 * @param after - The row after it.
 * @param show - Renders one field's value for a person, or returns undefined to skip the field.
 */
export function fieldDiffs(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  show: (field: string, value: unknown) => string | undefined,
): FieldDiff[] {
  return Object.keys(after).flatMap((field) => {
    const from = show(field, before[field]);
    const to = show(field, after[field]);
    return from === undefined || to === undefined || from === to ? [] : [{ field, from, to }];
  });
}
