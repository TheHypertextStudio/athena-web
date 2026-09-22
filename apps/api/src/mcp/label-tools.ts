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
import { db, labelGroup, team } from '@docket/db';
import { normalizeLabelName } from '@docket/work/label-contract';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import { ValidationError } from '../error';
import { originFor } from '../lib/provenance/context';
import {
  createLabel,
  createLabelGroup,
  findLabelByName,
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
  fieldDiffs,
  nameOf,
  skipFor,
  type CatalogKind,
  type CatalogRow,
  type CatalogSkip,
} from './catalog-rows';
import { recordChangeSet, type StoredChange } from './change-set';
import { catalogChange } from './change-set-catalog';
import { resolveDescriptor, resolveOptional } from './descriptors';
import { entityListHref } from './entity-href';
import {
  defineLabelsDefinition,
  MAX_DEFINITIONS,
  type GroupDefinition,
  type LabelDefinition,
} from './label-tools-contract';
import { authorize, jsonResult, runTool, scopedActor } from './result';

/** The recorded fields a report row may show; ids, timestamps and sort order are not news. */
const SHOWN = new Set(['name', 'color', 'groupId', 'teamId', 'exclusive']);

/**
 * One entry's write. Rows are built after every entry has run so that one query can name all the
 * teams and groups they mention. An entry that matched carries the same row as `before` and `after`.
 */
interface Written {
  readonly kind: 'label' | 'label_group';
  readonly before: LabelRow | LabelGroupRow | null;
  readonly after: LabelRow | LabelGroupRow;
}

/** State shared by every entry in one call. */
interface DefineRun {
  readonly actor: McpActor;
  readonly orgId: string;
  readonly written: Written[];
  readonly skipped: CatalogSkip[];
  /** One authorization per capability per call, since every entry asks about the same workspace. */
  readonly allowed: Map<string, Promise<void>>;
}

/** Whether an entry changed nothing. */
function matched(w: Written): boolean {
  return w.before === w.after;
}

/** Require a capability on the workspace, which is where the label vocabulary lives. */
function allow(run: DefineRun, capability: 'contribute' | 'manage'): Promise<void> {
  const cached = run.allowed.get(capability);
  if (cached) return cached;
  const check = authorize(run.actor, capability, {
    kind: 'organization',
    id: run.orgId,
    orgId: run.orgId,
  });
  run.allowed.set(capability, check);
  return check;
}

/** How a group's exclusivity reads on the card. */
function exclusivity(value: unknown): string {
  return value === true ? 'one at a time' : 'any combination';
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
    run.written.push({ kind: 'label_group', before: existing, after: existing });
    return;
  }
  await allow(run, 'manage');
  const after = existing
    ? await updateLabelGroup(run.orgId, existing.id, patch)
    : await createLabelGroup(run.orgId, wanted);
  run.written.push({ kind: 'label_group', before: existing ?? null, after });
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
  return findLabelByName(run.orgId, entry.name);
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
    run.written.push({ kind: 'label', before: null, after });
    return;
  }
  const patch = changedFields(existing, wanted);
  if (Object.keys(patch).length === 0) {
    run.written.push({ kind: 'label', before: existing, after: existing });
    return;
  }
  await allow(run, 'manage');
  const after = await updateLabel(run.orgId, existing.id, patch);
  run.written.push({ kind: 'label', before: existing, after });
}

/** Run one entry, turning a refusal into a skipped row so the entries before it still stand. */
async function attempt(
  run: DefineRun,
  kind: CatalogKind,
  name: string,
  write: () => Promise<void>,
): Promise<void> {
  try {
    await write();
  } catch (err) {
    run.skipped.push(skipFor(kind, name, err));
  }
}

/** How a person reads each recorded field. */
function showField(
  names: ReadonlyMap<string, string>,
): (field: string, value: unknown) => string | undefined {
  return (field, value) => {
    if (!SHOWN.has(field)) return undefined;
    if (field === 'teamId') return nameOf(names, value, 'Workspace');
    if (field === 'groupId') return nameOf(names, value, 'none');
    if (field === 'exclusive') return exclusivity(value);
    return String(value);
  };
}

/** Where a row lives, said the way the settings page groups it. */
function noteFor(w: Written, names: ReadonlyMap<string, string>): string {
  const after = w.after as Record<string, unknown>;
  const scope = nameOf(names, after['teamId'], 'Workspace');
  const parts =
    w.kind === 'label_group'
      ? ['Group', exclusivity(after['exclusive']), scope]
      : [nameOf(names, after['groupId'], 'No group'), scope];
  return [...(w.before === null ? ['New'] : []), ...parts].join(' · ');
}

/** Build the card rows, naming every team and group they mention from one query each. */
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
    href: entityListHref(run.orgId, w.kind),
    note: noteFor(w, names),
    matched: matched(w),
    fields: w.before === null ? [] : fieldDiffs(w.before, w.after, show),
  }));
}

/** The change-set entries for every entry that wrote something. */
function changesOf(written: readonly Written[]): StoredChange[] {
  return written.filter((w) => !matched(w)).map((w) => catalogChange(w.kind, w.before, w.after));
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
      const run: DefineRun = {
        actor,
        orgId: input.orgId,
        written: [],
        skipped: [],
        allowed: new Map(),
      };
      for (const g of groups) await attempt(run, 'label_group', g.name, () => defineGroup(run, g));
      for (const l of labels) await attempt(run, 'label', l.name, () => defineLabel(run, l));

      const changes = changesOf(run.written);
      const rows = await rowsFor(run);
      const changeSetId = await recordChangeSet({
        orgId: input.orgId,
        actorId: actor.actorId,
        origin: originFor('define_labels'),
        summary: `Defined ${run.written
          .filter((w) => !matched(w))
          .map((w) => `"${w.after.name}"`)
          .join(', ')}`,
        changes,
      });
      return jsonResult({
        changed: changes.length,
        listHref: entityListHref(input.orgId, 'label'),
        changes: rows,
        skipped: run.skipped,
        changeSetId,
      });
    }),
  );
}
