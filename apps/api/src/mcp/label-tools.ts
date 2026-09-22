/**
 * `@docket/api` — the `define_labels` tool.
 *
 * @remarks
 * "Add a Severity group with Low, Medium and High, and make Bug red" is one sentence, so it is one
 * call. Entries reconcile by name the way `organize` does: a name that already exists is an edit,
 * anything else is a create, and a second run of the same call writes nothing. That also means a
 * caller with only `contribute` access can re-run a call that created labels without being refused
 * for edits it is not actually making, because an entry that changes nothing never asks for
 * `manage`.
 *
 * The writes go through `lib/label-catalog.ts`, the same code the REST routes use, so scope and
 * name rules cannot differ between the settings page and an agent.
 */
import { db, label, labelGroup, team } from '@docket/db';
import { normalizeLabelName } from '@docket/work/label-contract';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import { ValidationError } from '../error';
import { originFor } from '../lib/provenance/context';
import {
  createLabel,
  createLabelGroup,
  requireLabel,
  requireLabelGroup,
  tidyLabelName,
  updateLabel,
  updateLabelGroup,
  type LabelGroupRow,
  type LabelRow,
} from '../lib/label-catalog';
import type { McpActor, McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import {
  catalogHref,
  fieldDiffs,
  skipFor,
  type CatalogRow,
  type CatalogRowKind,
  type CatalogSkip,
} from './catalog-rows';
import { recordChangeSet, type StoredChange } from './change-set';
import { catalogChange } from './change-set-catalog';
import { resolveDescriptor, resolveOptional } from './descriptors';
import {
  defineLabelsDefinition,
  MAX_DEFINITIONS,
  type GroupDefinition,
  type LabelDefinition,
} from './label-tools-contract';
import { authorize, jsonResult, runTool, scopedActor } from './result';

/** The recorded fields a report row may show; ids, timestamps and sort order are not news. */
const SHOWN = new Set(['name', 'color', 'groupId', 'teamId', 'exclusive']);

/** One entry's write, kept until every entry has run so rows can name groups made later. */
interface Written {
  readonly kind: 'label' | 'label_group';
  readonly before: LabelRow | LabelGroupRow | null;
  readonly after: LabelRow | LabelGroupRow;
  readonly matched: boolean;
}

/** State shared by every entry in one call. */
interface DefineRun {
  readonly actor: McpActor;
  readonly orgId: string;
  readonly written: Written[];
  readonly skipped: CatalogSkip[];
}

/** Require a capability on the workspace, which is where the label vocabulary lives. */
function allow(run: DefineRun, capability: 'contribute' | 'manage'): Promise<void> {
  return authorize(run.actor, capability, {
    kind: 'organization',
    id: run.orgId,
    orgId: run.orgId,
  });
}

/** Keep only the fields whose requested value differs from the row's. */
function changedFields<T extends Record<string, unknown>>(
  row: Record<string, unknown>,
  wanted: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(wanted).filter(([key, value]) => value !== undefined && value !== row[key]),
  ) as Partial<T>;
}

/** Find the group an entry means: the named one, or one already called `name` in that scope. */
async function findGroup(
  run: DefineRun,
  entry: z.infer<typeof GroupDefinition>,
  teamId: string | null | undefined,
): Promise<LabelGroupRow | undefined> {
  if (entry.group !== undefined) {
    const id = await resolveDescriptor(run.orgId, 'label_group', entry.group, 'groups.group');
    return requireLabelGroup(run.orgId, id);
  }
  const wanted = normalizeLabelName(entry.name);
  const groups = await db.select().from(labelGroup).where(eq(labelGroup.organizationId, run.orgId));
  return groups.find(
    (g) => normalizeLabelName(g.name) === wanted && (teamId === undefined || g.teamId === teamId),
  );
}

/** Create or edit one label group. */
async function defineGroup(run: DefineRun, entry: z.infer<typeof GroupDefinition>): Promise<void> {
  const teamId = await resolveOptional(run.orgId, 'team', entry.team, 'groups.team');
  const existing = await findGroup(run, entry, teamId);
  const wanted = { name: tidyLabelName(entry.name), exclusive: entry.exclusive, teamId };
  const patch = existing ? changedFields(existing, wanted) : wanted;
  if (existing && Object.keys(patch).length === 0) {
    run.written.push({ kind: 'label_group', before: existing, after: existing, matched: true });
    return;
  }
  await allow(run, 'manage');
  const after = existing
    ? await updateLabelGroup(run.orgId, existing.id, patch)
    : await createLabelGroup(run.orgId, wanted);
  run.written.push({ kind: 'label_group', before: existing ?? null, after, matched: false });
}

/** Find the label an entry means: the named one, or the one already called `name`. */
async function findLabel(
  run: DefineRun,
  entry: z.infer<typeof LabelDefinition>,
): Promise<LabelRow | undefined> {
  if (entry.label !== undefined) {
    const id = await resolveDescriptor(run.orgId, 'label', entry.label, 'labels.label');
    return requireLabel(run.orgId, id);
  }
  // Label names are unique across the org without regard to case, so a name match is the label.
  const wanted = normalizeLabelName(entry.name);
  const labels = await db.select().from(label).where(eq(label.organizationId, run.orgId));
  return labels.find((l) => normalizeLabelName(l.name) === wanted);
}

/** Create or edit one label. */
async function defineLabel(run: DefineRun, entry: z.infer<typeof LabelDefinition>): Promise<void> {
  const [teamId, groupId, existing] = await Promise.all([
    resolveOptional(run.orgId, 'team', entry.team, 'labels.team'),
    resolveOptional(run.orgId, 'label_group', entry.group, 'labels.group'),
    findLabel(run, entry),
  ]);
  const wanted = { name: tidyLabelName(entry.name), color: entry.color, groupId, teamId };
  if (!existing) {
    await allow(run, 'contribute');
    const after = await createLabel(run.orgId, wanted);
    run.written.push({ kind: 'label', before: null, after, matched: false });
    return;
  }
  const patch = changedFields(existing, wanted);
  if (Object.keys(patch).length === 0) {
    run.written.push({ kind: 'label', before: existing, after: existing, matched: true });
    return;
  }
  await allow(run, 'manage');
  const after = await updateLabel(run.orgId, existing.id, patch);
  run.written.push({ kind: 'label', before: existing, after, matched: false });
}

/** Run one entry, turning a refusal into a skipped row so the entries before it still stand. */
async function attempt(
  run: DefineRun,
  kind: CatalogRowKind,
  name: string,
  write: () => Promise<void>,
): Promise<void> {
  try {
    await write();
  } catch (err) {
    run.skipped.push(skipFor(kind, null, name, err));
  }
}

/** How a person reads each recorded field. */
function showField(
  names: ReadonlyMap<string, string>,
): (field: string, value: unknown) => string | undefined {
  const named = (value: unknown, unset: string): string =>
    typeof value === 'string' ? (names.get(value) ?? value) : unset;
  return (field, value) => {
    if (!SHOWN.has(field)) return undefined;
    if (field === 'teamId') return named(value, 'Workspace');
    if (field === 'groupId') return named(value, 'none');
    if (field === 'exclusive') return value === true ? 'one at a time' : 'any combination';
    return String(value);
  };
}

/** Where a row lives, said the way the settings page groups it. */
function noteFor(w: Written, names: ReadonlyMap<string, string>): string {
  const after = w.after as Record<string, unknown>;
  const named = (value: unknown, unset: string): string =>
    typeof value === 'string' ? (names.get(value) ?? unset) : unset;
  const scope = named(after['teamId'], 'Workspace');
  const parts =
    w.kind === 'label_group'
      ? ['Group', after['exclusive'] === true ? 'one at a time' : 'any combination', scope]
      : [named(after['groupId'], 'No group'), scope];
  return [...(w.before === null ? ['New'] : []), ...parts].join(' · ');
}

/** Build the card rows once every entry has run. */
async function rowsFor(run: DefineRun): Promise<CatalogRow[]> {
  const [teams, groups] = await Promise.all([
    db
      .select({ id: team.id, name: team.name })
      .from(team)
      .where(eq(team.organizationId, run.orgId)),
    db
      .select({ id: labelGroup.id, name: labelGroup.name })
      .from(labelGroup)
      .where(eq(labelGroup.organizationId, run.orgId)),
  ]);
  const names = new Map([...teams, ...groups].map((r) => [r.id, r.name]));
  const show = showField(names);
  return run.written.map((w) => ({
    kind: w.kind,
    id: w.after.id,
    title: w.after.name,
    href: catalogHref(run.orgId, w.kind),
    note: noteFor(w, names),
    matched: w.matched,
    fields: w.before === null || w.matched ? [] : fieldDiffs(w.before, w.after, show),
  }));
}

/** The change-set entries for every entry that wrote something. */
function changesOf(written: readonly Written[]): StoredChange[] {
  return written.filter((w) => !w.matched).map((w) => catalogChange(w.kind, w.before, w.after));
}

/** Refuse a call larger than one report card can show and one person can check. */
function assertSize(groups: readonly unknown[], labels: readonly unknown[]): void {
  if (groups.length + labels.length === 0 || groups.length + labels.length > MAX_DEFINITIONS) {
    throw new ValidationError([
      {
        path: ['labels'],
        message: `Define between 1 and ${MAX_DEFINITIONS} groups and labels in one call.`,
      },
    ]);
  }
}

/** Register `define_labels` on `server`. */
export function registerLabelTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool('define_labels', defineLabelsDefinition, (input) =>
    runTool(async () => {
      const actor = await scopedActor(ctx, input.orgId, 'work:write');
      await authorize(actor, 'view', { kind: 'organization', id: input.orgId, orgId: input.orgId });
      const groups = input.groups ?? [];
      const labels = input.labels ?? [];
      assertSize(groups, labels);
      const run: DefineRun = { actor, orgId: input.orgId, written: [], skipped: [] };
      for (const g of groups) await attempt(run, 'label_group', g.name, () => defineGroup(run, g));
      for (const l of labels) await attempt(run, 'label', l.name, () => defineLabel(run, l));

      const changes = changesOf(run.written);
      const rows = await rowsFor(run);
      const changeSetId = await recordChangeSet({
        orgId: input.orgId,
        actorId: actor.actorId,
        origin: originFor('define_labels'),
        summary: `Defined ${rows
          .filter((r) => !r.matched)
          .map((r) => `"${r.title}"`)
          .join(', ')}`,
        changes,
      });
      return jsonResult({
        changed: changes.length,
        listHref: catalogHref(input.orgId, 'label'),
        changes: rows,
        skipped: run.skipped,
        changeSetId,
      });
    }),
  );
}
