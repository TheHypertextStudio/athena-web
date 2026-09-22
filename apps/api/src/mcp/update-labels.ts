/**
 * `@docket/api` — the `labels` field of the `update` tool.
 *
 * @remarks
 * "Tag everything Sarah filed today as Bug" is one `update` call, so labels ride on the same scope
 * and the same report card as every other field. Each row's label set is written through
 * `lib/labels.ts`, which enforces group exclusivity, and is recorded as one snapshot per row so
 * `undo` can put it back (see `change-set-labels.ts`).
 *
 * A label limited to one team can only go on that team's work, the same rule the product's label
 * picker follows. A row outside that team is reported as `label_out_of_scope` and left entirely
 * alone, including its other fields, because a half-applied row would be harder to check than a
 * skipped one.
 */
import { db } from '@docket/db';
import { z } from 'zod';

import { ValidationError } from '../error';
import {
  applyExclusivity,
  labelsForSubject,
  replaceLabels,
  resolveAttachedLabels,
  resolveLabelCatalog,
  type ResolvedLabel,
  type ScopedResolvedLabel,
} from '../lib/labels';
import type { FieldDiff } from './catalog-rows';
import type { StoredChange } from './change-set';
import { labelSetChange, sameIds, type LabelSetSubject } from './change-set-labels';
import { DESCRIPTOR_HINT, resolveDescriptor } from './descriptors';

/** The `set.labels` wire field. */
export const labelsSetField = z
  .object({
    add: z
      .array(z.string())
      .optional()
      .describe(
        'Labels to put on each item. A label in an exclusive group replaces the item’s other label from that group.',
      ),
    remove: z.array(z.string()).optional().describe('Labels to take off each item.'),
    replace: z
      .array(z.string())
      .optional()
      .describe(
        'The exact label set each item should end with; an empty list clears them. Cannot be combined with add or remove.',
      ),
  })
  .optional()
  .describe(
    `Change the labels on tasks, projects, initiatives, or programs. ${DESCRIPTOR_HINT} A label limited to one team only goes on that team's work; other items are skipped with reason label_out_of_scope.`,
  );

/** The caller's label change, resolved to labels once for every row. */
export interface LabelEdit {
  readonly add: readonly ScopedResolvedLabel[];
  readonly removeIds: ReadonlySet<string>;
  readonly replace: readonly ScopedResolvedLabel[] | undefined;
}

/** What one row's label write did: its diff line and its change-set entry. */
export interface RowLabelResult {
  readonly field: FieldDiff;
  readonly change: StoredChange;
}

/** Resolve names or ids to labels, keeping the caller's order. */
async function resolveAll(
  orgId: string,
  values: readonly string[],
  field: string,
): Promise<ScopedResolvedLabel[]> {
  const ids = await Promise.all(values.map((v) => resolveDescriptor(orgId, 'label', v, field)));
  const byId = new Map((await resolveLabelCatalog(orgId, ids)).map((l) => [l.id, l]));
  return [...new Set(ids)].flatMap((id) => byId.get(id) ?? []);
}

/**
 * Resolve `set.labels` once, before any row is touched.
 *
 * @param orgId - The organization being updated.
 * @param value - The caller's `set.labels`, if any.
 * @returns The resolved edit, or undefined when the caller did not mention labels.
 * @throws {ValidationError} When `replace` is combined with `add` or `remove`, or a name matches
 *   no label.
 */
export async function resolveLabelEdit(
  orgId: string,
  value: z.infer<typeof labelsSetField>,
): Promise<LabelEdit | undefined> {
  if (value === undefined) return undefined;
  if (value.replace !== undefined && (value.add !== undefined || value.remove !== undefined)) {
    throw new ValidationError([
      { path: ['set', 'labels'], message: 'Use replace on its own, or add and remove together.' },
    ]);
  }
  const [add, remove, replace] = await Promise.all([
    resolveAll(orgId, value.add ?? [], 'set.labels.add'),
    resolveAll(orgId, value.remove ?? [], 'set.labels.remove'),
    value.replace === undefined
      ? undefined
      : resolveAll(orgId, value.replace, 'set.labels.replace'),
  ]);
  return { add, removeIds: new Set(remove.map((l) => l.id)), replace };
}

/**
 * Whether every label the edit puts on a row may go on it.
 *
 * @param edit - The resolved edit.
 * @param teamId - The row's team after this update, or null when it has none.
 */
export function labelsFitRow(edit: LabelEdit, teamId: string | null): boolean {
  const incoming = edit.replace ?? edit.add;
  return incoming.every((l) => l.teamId === null || l.teamId === teamId);
}

/** The label set a row ends with. Incoming labels go last so they win exclusive groups. */
function nextSet(edit: LabelEdit, current: readonly ResolvedLabel[]): ResolvedLabel[] {
  if (edit.replace !== undefined) return applyExclusivity(edit.replace);
  const incomingIds = new Set(edit.add.map((l) => l.id));
  const kept = current.filter((l) => !edit.removeIds.has(l.id) && !incomingIds.has(l.id));
  return applyExclusivity([...kept, ...edit.add]);
}

/** Label names as one diff value, alphabetical so the two sides line up. */
function names(labels: readonly ResolvedLabel[]): string {
  return labels.length === 0
    ? 'none'
    : labels
        .map((l) => l.name)
        .sort()
        .join(', ');
}

/**
 * Apply the edit to one row's labels.
 *
 * @param subject - What kind of work the row is.
 * @param orgId - The organization.
 * @param subjectId - The row's id.
 * @param edit - The resolved edit.
 * @returns The diff line and change-set entry, or null when the set did not move.
 */
export async function applyLabelEdit(
  subject: LabelSetSubject,
  orgId: string,
  subjectId: string,
  edit: LabelEdit,
): Promise<RowLabelResult | null> {
  return db.transaction(async (tx) => {
    const attachedIds = (await labelsForSubject(subject, orgId, subjectId, tx)).map((l) => l.id);
    const current = await resolveAttachedLabels(orgId, attachedIds, tx);
    const next = nextSet(edit, current);
    const beforeIds = current.map((l) => l.id).sort();
    const afterIds = next.map((l) => l.id).sort();
    if (sameIds(beforeIds, afterIds)) return null;
    await replaceLabels(tx, subject, subjectId, orgId, next);
    return {
      field: { field: 'labels', from: names(current), to: names(next) },
      change: labelSetChange(subject, subjectId, beforeIds, afterIds),
    };
  });
}
