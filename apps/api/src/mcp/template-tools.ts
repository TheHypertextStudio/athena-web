/**
 * `@docket/api` — the `define_template` tool.
 *
 * @remarks
 * One template per call, unlike `define_labels`. A template carries a whole draft, and a card that
 * shows several drafts' diffs at once is not one a person can check.
 *
 * The writes go through `lib/templates/write.ts`, the same code the REST routes use. The one rule
 * this tool adds is on labels: REST stores whatever label ids a payload names, while this tool
 * resolves them and refuses a label the template's scope could never apply, because an agent that
 * wrote "Bug" deserves to hear that Bug belongs to another team now rather than when someone
 * creates a task from the template.
 */
import { db, team, template } from '@docket/db';
import { TemplateCreate, TemplateUpdate, type TemplateDraft } from '@docket/work/template-contract';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import { ValidationError } from '../error';
import { resolveAttachedLabels, resolveLabelSet } from '../lib/labels';
import { originFor } from '../lib/provenance/context';
import { visibleTemplateWhere } from '../lib/templates/visibility';
import {
  createTemplate,
  requireVisibleTemplate,
  updateTemplate,
  type TemplateRow,
} from '../lib/templates/write';
import type { McpActor, McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { catalogHref, fieldDiffs, type CatalogRow } from './catalog-rows';
import { recordChangeSet } from './change-set';
import { catalogChange } from './change-set-catalog';
import { pick, resolveDescriptor, resolveOptional } from './descriptors';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { defineTemplateDefinition } from './template-tools-contract';

/** The tool's validated input. */
type DefineTemplateInput = {
  [K in keyof typeof defineTemplateDefinition.inputSchema]: z.infer<
    (typeof defineTemplateDefinition.inputSchema)[K]
  >;
};

/** Every id in Docket is a 26-char ULID, so a name can never be mistaken for one. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** The longest a diff value may run before it is cut. */
const DISPLAY_LIMIT = 120;

/** Payload keys renamed for the card, where they would otherwise read as the template's own. */
const DRAFT_FIELD: Record<string, string> = {
  title: 'draftTitle',
  name: 'draftName',
  description: 'body',
  labelIds: 'labels',
};

/** Raise a field error on one argument. */
function invalid(field: string, message: string): never {
  throw new ValidationError([{ path: [field], message }]);
}

/** Find the template a caller named, from the ones visible to them. */
async function findTemplate(actor: McpActor, orgId: string, value: string): Promise<TemplateRow> {
  if (ULID.test(value)) return requireVisibleTemplate(orgId, actor.actorId, value);
  const visible = await db
    .select({ id: template.id, label: template.name })
    .from(template)
    .where(visibleTemplateWhere(orgId, actor.actorId, {}));
  return requireVisibleTemplate(orgId, actor.actorId, await pick('template', value, visible));
}

/**
 * Resolve the labels a task template starts with, refusing any the template could not apply.
 *
 * @returns The label ids, or undefined when the call names no labels.
 */
async function templateLabelIds(
  orgId: string,
  names: readonly string[] | undefined,
  draft: TemplateDraft | undefined,
  teamId: string | null,
): Promise<string[] | undefined> {
  const wanted = names ?? (draft?.targetType === 'task' ? draft.labelIds : undefined);
  if (wanted === undefined) return undefined;
  if (draft !== undefined && draft.targetType !== 'task') {
    invalid('labels', 'Only a task template carries labels.');
  }
  const ids = await Promise.all(wanted.map((v) => resolveDescriptor(orgId, 'label', v, 'labels')));
  // Throws when a label is limited to a team other than the template's, the same refusal the
  // task composer gives when the template is applied.
  return (await resolveLabelSet(orgId, ids, { teamId })).map((l) => l.id);
}

/** The draft to write: the caller's, or the stored one when only its labels change. */
function draftToWrite(
  input: DefineTemplateInput,
  before: TemplateRow | null,
): TemplateDraft | undefined {
  if (input.payload !== undefined) return input.payload;
  return input.labels !== undefined && before ? before.payload : undefined;
}

/** The team whose labels the template may carry: its team when team-scoped, otherwise none. */
function labelTeam(
  input: DefineTemplateInput,
  before: TemplateRow | null,
  teamId: string | undefined,
): string | null {
  const scope = input.scope ?? before?.scope ?? 'personal';
  if (scope !== 'team') return null;
  return teamId ?? before?.teamId ?? null;
}

/**
 * Resolve the draft and its labels into the payload to store, if the call changes it.
 *
 * @returns The unvalidated payload; the REST contract parses it and brands its ids.
 */
async function payloadToWrite(
  input: DefineTemplateInput,
  before: TemplateRow | null,
  teamId: string | undefined,
): Promise<z.input<typeof TemplateDraft> | undefined> {
  const draft = draftToWrite(input, before);
  const labelIds = await templateLabelIds(
    input.orgId,
    input.labels,
    draft ?? before?.payload,
    labelTeam(input, before, teamId),
  );
  if (draft?.targetType !== 'task' || labelIds === undefined) return draft;
  return { ...draft, labelIds };
}

/** Refuse an edit that names nothing to change. */
function assertSomethingToChange(input: DefineTemplateInput): void {
  const fields = [
    input.name,
    input.description,
    input.scope,
    input.team,
    input.payload,
    input.labels,
  ];
  if (fields.every((value) => value === undefined)) {
    invalid('template', 'Name at least one thing to change.');
  }
}

/** Validate a body against a REST contract, reporting failures on the MCP arguments. */
function parsed<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new ValidationError(result.error);
  return result.data;
}

/** Create or edit the template, returning its state on both sides. */
async function writeTemplate(
  actor: McpActor,
  input: DefineTemplateInput,
): Promise<{ before: TemplateRow | null; after: TemplateRow }> {
  const orgId = input.orgId;
  const before = input.template ? await findTemplate(actor, orgId, input.template) : null;
  if (before) assertSomethingToChange(input);
  const teamId = await resolveOptional(orgId, 'team', input.team, 'team');
  const payload = await payloadToWrite(input, before, teamId);
  const fields = { name: input.name, description: input.description, scope: input.scope, teamId };
  if (before) {
    const body = parsed(TemplateUpdate, { ...fields, payload });
    return updateTemplate(orgId, actor.actorId, before.id, body);
  }
  if (!input.name || !payload) invalid('payload', 'A new template needs a name and a payload.');
  const body = parsed(TemplateCreate, { ...fields, targetType: payload.targetType, payload });
  return { before: null, after: await createTemplate(orgId, actor.actorId, body) };
}

/** Flatten a template into the fields its card row compares, with ids turned into names. */
function snapshot(row: TemplateRow, names: ReadonlyMap<string, string>): Record<string, unknown> {
  const named = (ids: readonly unknown[]): string =>
    ids.map((id) => names.get(String(id)) ?? String(id)).join(', ');
  const draft = Object.entries(row.payload as Record<string, unknown>)
    .filter(([key]) => key !== 'targetType')
    .map(([key, value]): [string, unknown] => [
      DRAFT_FIELD[key] ?? key,
      Array.isArray(value) ? named(value as unknown[]) : value,
    ])
    // `jsonb` does not keep key order, so sort to give the card one stable order.
    .sort(([a], [b]) => a.localeCompare(b));
  return {
    name: row.name,
    description: row.description,
    scope: row.scope,
    teamId: row.teamId === null ? null : (names.get(row.teamId) ?? row.teamId),
    ...Object.fromEntries(draft),
  };
}

/** Render one compared value, cut short so a long body cannot swamp the card. */
function show(_field: string, value: unknown): string {
  const text =
    value === null || value === undefined || value === ''
      ? 'none'
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  return text.length > DISPLAY_LIMIT ? `${text.slice(0, DISPLAY_LIMIT - 1).trimEnd()}…` : text;
}

/** Where the template lives, said the way the picker groups it. */
function noteFor(row: TemplateRow, created: boolean, names: ReadonlyMap<string, string>): string {
  const kind = `${row.targetType.charAt(0).toUpperCase()}${row.targetType.slice(1)} template`;
  const scope =
    row.scope === 'personal'
      ? 'Only you'
      : row.scope === 'team' && row.teamId
        ? (names.get(row.teamId) ?? 'Team')
        : 'Workspace';
  return [...(created ? ['New'] : []), kind, scope].join(' · ');
}

/** Build the card row for the written template. */
async function rowFor(
  orgId: string,
  before: TemplateRow | null,
  after: TemplateRow,
): Promise<CatalogRow> {
  const teams = await db
    .select({ id: team.id, name: team.name })
    .from(team)
    .where(eq(team.organizationId, orgId));
  const labelIds = [before?.payload, after.payload].flatMap((p) =>
    p?.targetType === 'task' ? (p.labelIds ?? []) : [],
  );
  const labels = await labelsFor(orgId, labelIds);
  const names = new Map([...teams, ...labels].map((r) => [r.id, r.name]));
  const fields = before ? fieldDiffs(snapshot(before, names), snapshot(after, names), show) : [];
  return {
    kind: 'template',
    id: after.id,
    title: after.name,
    href: catalogHref(orgId, 'template'),
    note: noteFor(after, before === null, names),
    matched: before !== null && fields.length === 0,
    fields,
  };
}

/** Load label names for display, dropping any since deleted. */
function labelsFor(orgId: string, ids: readonly string[]): Promise<{ id: string; name: string }[]> {
  return resolveAttachedLabels(orgId, ids);
}

/** Register `define_template` on `server`. */
export function registerTemplateTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool('define_template', defineTemplateDefinition, (input) =>
    runTool(async () => {
      const actor = await scopedActor(ctx, input.orgId, 'work:write');
      await authorize(actor, 'contribute', {
        kind: 'organization',
        id: input.orgId,
        orgId: input.orgId,
      });
      const { before, after } = await writeTemplate(actor, input);
      const row = await rowFor(input.orgId, before, after);
      const changed = !row.matched;
      const changeSetId = await recordChangeSet({
        orgId: input.orgId,
        actorId: actor.actorId,
        origin: originFor('define_template'),
        summary: `${before ? 'Edited' : 'Created'} template "${after.name}"`,
        changes: changed ? [catalogChange('template', before, after)] : [],
      });
      return jsonResult({
        changed: changed ? 1 : 0,
        listHref: catalogHref(input.orgId, 'template'),
        changes: [row],
        skipped: [],
        changeSetId,
      });
    }),
  );
}
