/**
 * `@docket/api` — how a person should read the fields an `update` changed.
 *
 * @remarks
 * `update` reports each changed column as the model reads it: raw ids, the per-team state key, the
 * status id that moves with every state change, and long text clamped to its first 200 characters.
 * That is right for the model and wrong for a person, who reads an assignee as a name, a state
 * change as one field, and a rewritten brief as the words that changed. This builds that reading
 * from the untruncated before and after values, and the result carries it in `_meta` for the change
 * report to draw (see `change-report.ts`).
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { actor, cycle, db, milestone, program, project, task, team } from '@docket/db';
import { defaultCycleName } from '@docket/work/cycle-contract';
import { and, eq, inArray } from 'drizzle-orm';

import { markdownToPlainText } from '../../content/markdown-links';
import type { ChangeRecord } from '../change-set';
import { jsonResult } from '../result';
import { stateNameOf, teamWorkflows, type TeamWorkflows } from '../workflow-states';
import { RENDER_META_KEY } from './rich-text';
import { wordRewrite, type WordRewrite } from './text-diff';

/** How one changed field reads. Anything left unset reads as the report's own value. */
export interface FieldRender {
  /** Folded into another field that moved in the same write, so it is not shown on its own. */
  readonly hidden?: true;
  readonly from?: string;
  readonly to?: string;
  /** For long text: the words that changed. */
  readonly rewrite?: WordRewrite;
}

/** The render model an `update` result carries, by item id and field. */
export interface ChangeRender {
  readonly changes: Readonly<Record<string, Readonly<Record<string, FieldRender>>>>;
}

/** One reported row: its id and which fields moved. */
interface ReportedChange {
  readonly id: string;
  readonly fields: readonly { readonly field: string }[];
}

/** Fields a person reads as part of another field that moved in the same write. */
const FOLDED_INTO: Readonly<Record<string, readonly string[]>> = {
  statusId: ['state', 'status'],
  completedAt: ['state', 'status'],
  canceledAt: ['state', 'status'],
  autoCompletedBySubtasks: ['state'],
  startDateResolution: ['startDate'],
  startDateFiscalYearStartMonth: ['startDate'],
  targetDateResolution: ['targetDate'],
  targetDateFiscalYearStartMonth: ['targetDate'],
  estimateMinutes: ['estimate'],
};

/** Writing that is diffed by word rather than shown whole. */
const LONG_TEXT: ReadonlySet<string> = new Set(['description', 'summary']);

type NameKind = 'actor' | 'project' | 'program' | 'milestone' | 'cycle' | 'task' | 'team';

/** Id columns, and the kind of thing each names. */
const NAMED: Readonly<Record<string, NameKind>> = {
  assigneeId: 'actor',
  delegateId: 'actor',
  leadId: 'actor',
  ownerId: 'actor',
  projectId: 'project',
  programId: 'program',
  milestoneId: 'milestone',
  cycleId: 'cycle',
  parentTaskId: 'task',
  teamId: 'team',
};

type Names = ReadonlyMap<string, string>;
type Lookup = (orgId: string, ids: string[]) => Promise<readonly (readonly [string, string])[]>;

/** How to name each kind, in one query for every id of that kind. */
const LOOKUPS: Readonly<Record<NameKind, Lookup>> = {
  actor: async (orgId, ids) =>
    (
      await db
        .select({ id: actor.id, name: actor.displayName })
        .from(actor)
        .where(and(eq(actor.organizationId, orgId), inArray(actor.id, ids)))
    ).map((row) => [row.id, row.name] as const),
  project: async (orgId, ids) =>
    (
      await db
        .select({ id: project.id, name: project.name })
        .from(project)
        .where(and(eq(project.organizationId, orgId), inArray(project.id, ids)))
    ).map((row) => [row.id, row.name] as const),
  program: async (orgId, ids) =>
    (
      await db
        .select({ id: program.id, name: program.name })
        .from(program)
        .where(and(eq(program.organizationId, orgId), inArray(program.id, ids)))
    ).map((row) => [row.id, row.name] as const),
  milestone: async (orgId, ids) =>
    (
      await db
        .select({ id: milestone.id, name: milestone.name })
        .from(milestone)
        .where(and(eq(milestone.organizationId, orgId), inArray(milestone.id, ids)))
    ).map((row) => [row.id, row.name] as const),
  cycle: async (orgId, ids) =>
    (
      await db
        .select({ id: cycle.id, name: cycle.name, startsAt: cycle.startsAt, endsAt: cycle.endsAt })
        .from(cycle)
        .where(and(eq(cycle.organizationId, orgId), inArray(cycle.id, ids)))
    ).map((row) => [row.id, row.name ?? defaultCycleName(row.startsAt, row.endsAt)] as const),
  task: async (orgId, ids) =>
    (
      await db
        .select({ id: task.id, name: task.title })
        .from(task)
        .where(and(eq(task.organizationId, orgId), inArray(task.id, ids)))
    ).map((row) => [row.id, row.name] as const),
  team: async (orgId, ids) =>
    (
      await db
        .select({ id: team.id, name: team.name })
        .from(team)
        .where(and(eq(team.organizationId, orgId), inArray(team.id, ids)))
    ).map((row) => [row.id, row.name] as const),
};

const asId = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Every id an id column moved from or to, grouped by the kind it names. */
function wantedNames(pairs: readonly FieldPair[]): Map<NameKind, Set<string>> {
  const wanted = new Map<NameKind, Set<string>>();
  for (const { field, before, after } of pairs) {
    const kind = NAMED[field];
    if (!kind) continue;
    const ids = wanted.get(kind) ?? new Set<string>();
    for (const id of [asId(before), asId(after)]) if (id) ids.add(id);
    wanted.set(kind, ids);
  }
  return wanted;
}

/** Name every id the report needs, keyed `kind:id`. */
async function namesFor(orgId: string, pairs: readonly FieldPair[]): Promise<Names> {
  const wanted = [...wantedNames(pairs)].filter(([, ids]) => ids.size > 0);
  const rows = await Promise.all(
    wanted.map(async ([kind, ids]) =>
      (await LOOKUPS[kind](orgId, [...ids])).map(([id, name]) => [`${kind}:${id}`, name] as const),
    ),
  );
  return new Map(rows.flat());
}

/** One changed field with the values on either side of it. */
interface FieldPair {
  readonly id: string;
  readonly field: string;
  readonly moved: readonly string[];
  readonly before: unknown;
  readonly after: unknown;
  readonly beforeTeam: string | null;
  readonly afterTeam: string | null;
}

/** Pair each reported field with its untruncated values from the change record. */
function pairsOf(
  reported: readonly ReportedChange[],
  records: readonly ChangeRecord[],
): FieldPair[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  return reported.flatMap((item) => {
    const record = byId.get(item.id);
    if (!record) return [];
    const before = record.before ?? {};
    const after = record.after ?? {};
    const moved = item.fields.map((f) => f.field);
    return moved.map((field) => ({
      id: item.id,
      field,
      moved,
      before: before[field],
      after: after[field],
      beforeTeam: asId(before['teamId']),
      afterTeam: asId(after['teamId']),
    }));
  });
}

/** Long text, as the words a person reads. */
const plainOf = (value: unknown): string =>
  typeof value === 'string' ? markdownToPlainText(value, 100_000) : '';

/** What an id column reads as when the thing it named no longer exists. */
const GONE: Readonly<Record<NameKind, string>> = {
  actor: 'Former member',
  project: 'Deleted project',
  program: 'Deleted program',
  milestone: 'Deleted milestone',
  cycle: 'Deleted cycle',
  task: 'Deleted task',
  team: 'Deleted team',
};

/** A state change in the owning team's own words. */
function stateRender(pair: FieldPair, workflows: TeamWorkflows): FieldRender | null {
  const from = stateNameOf(workflows, pair.beforeTeam, asId(pair.before));
  const to = stateNameOf(workflows, pair.afterTeam, asId(pair.after));
  if (!from && !to) return null;
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

/** An id column as the names on either side of it. */
function namedRender(pair: FieldPair, kind: NameKind, names: Names): FieldRender {
  const nameOf = (value: unknown): string => {
    const id = asId(value);
    if (!id) return 'none';
    return names.get(`${kind}:${id}`) ?? GONE[kind];
  };
  return { from: nameOf(pair.before), to: nameOf(pair.after) };
}

/** Long text as the words that changed; a change of formatting alone says so. */
function textRender(pair: FieldPair): FieldRender {
  const rewrite = wordRewrite(plainOf(pair.before), plainOf(pair.after));
  return rewrite ? { rewrite } : { from: 'none', to: 'Formatting changed' };
}

/** How one field reads, or `null` when the report's own value already reads correctly. */
function fieldRenderOf(
  pair: FieldPair,
  names: Names,
  workflows: TeamWorkflows,
): FieldRender | null {
  const folded = FOLDED_INTO[pair.field];
  if (folded?.some((field) => pair.moved.includes(field))) return { hidden: true };
  if (pair.field === 'state') return stateRender(pair, workflows);
  const kind = NAMED[pair.field];
  if (kind) return namedRender(pair, kind, names);
  return LONG_TEXT.has(pair.field) ? textRender(pair) : null;
}

/**
 * Build how a person reads an `update`'s changes.
 *
 * @param orgId - The organization the write happened in.
 * @param reported - The report rows, each with the fields that moved.
 * @param records - The change records holding each row's untruncated before and after.
 * @returns Field renders by item id; fields that already read correctly are left out.
 */
export async function changeRenderOf(
  orgId: string,
  reported: readonly ReportedChange[],
  records: readonly ChangeRecord[],
): Promise<ChangeRender> {
  const pairs = pairsOf(reported, records);
  const teams = pairs.flatMap((pair) => [pair.beforeTeam, pair.afterTeam]);
  const [names, workflows] = await Promise.all([
    namesFor(orgId, pairs),
    teamWorkflows(
      orgId,
      teams.filter((teamId): teamId is string => teamId !== null),
    ),
  ]);
  const changes: Record<string, Record<string, FieldRender>> = {};
  for (const pair of pairs) {
    const render = fieldRenderOf(pair, names, workflows);
    if (!render) continue;
    changes[pair.id] = { ...changes[pair.id], [pair.field]: render };
  }
  return { changes };
}

/**
 * The result of an `update`: the report for the model, and how to read it for the card.
 *
 * @param orgId - The organization the write happened in.
 * @param report - What `update` reports, exactly as the model reads it.
 * @param records - The change records behind the report's rows.
 * @returns A result whose `_meta` carries the change render when any field needs one.
 */
export async function updateReportResult(
  orgId: string,
  report: { readonly changes: readonly ReportedChange[] } & Record<string, unknown>,
  records: readonly ChangeRecord[],
): Promise<CallToolResult> {
  const render = await changeRenderOf(orgId, report.changes, records);
  const meta = Object.keys(render.changes).length > 0 ? { [RENDER_META_KEY]: render } : undefined;
  return jsonResult(report, meta);
}
