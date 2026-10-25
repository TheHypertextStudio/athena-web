import { writeTemplateProposal } from '../agent/template-proposal-write';
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
import { changeSet, db, team } from '@docket/db';
import { TemplateCreate, TemplateUpdate, type TemplateDraft } from '@docket/work/template-contract';
import { eq } from 'drizzle-orm';
import { WorkTemplateCreate, WorkTemplateDefinition } from '@docket/work/work-template-contract';
import {
  archiveWorkTemplate,
  createWorkTemplate,
  editWorkTemplateDraft,
  publishWorkTemplate,
  createWorkTemplateInTransaction,
  editWorkTemplateDraftInTransaction,
  reconcileTemplateCreationEffects,
} from '../lib/templates/service';
import { lockTemplate, requireRevision } from '../lib/templates/persistence';
import { reconcileTemplateImages } from '../lib/templates/images';
import { serializableTx } from '../lib/serializable-tx';
import {
  isAutomatedTemplateContext,
  requireAutomatedTemplateAuthor,
  registeredTemplateSessionId,
} from '../agent/template-authority';
import { draftOf } from '../lib/templates/model';
import { z } from 'zod';

import { ValidationError } from '../error';
import { resolveAttachedLabels, resolveLabelSet } from '../lib/labels';
import { originFor } from '../lib/provenance/context';
import { createTemplate, updateTemplate, type TemplateRow } from '../lib/templates/write';
import type { McpActor, McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { fieldDiffs, nameOf, type CatalogRow } from './catalog-rows';
import { recordChangeSet, recordChangeSetInTransaction } from './change-set';
import { catalogChange } from './change-set-catalog';
import { resolveDescriptor, resolveOptional } from './descriptors';
import { entityListHref } from './entity-href';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { defineTemplateDefinition } from './template-tools-contract';
import { resolveVisibleTemplate } from './template-application';

/** The tool's validated input. */
type DefineTemplateInput = z.infer<z.ZodObject<typeof defineTemplateDefinition.inputSchema>>;

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
  return input.labels !== undefined && before
    ? input.action === 'draft'
      ? draftOf(before).payload
      : before.payload
    : undefined;
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
  if (draft === undefined) return undefined;
  const labelIds = await templateLabelIds(
    input.orgId,
    input.labels,
    draft,
    labelTeam(input, before, teamId),
  );
  if (draft.targetType !== 'task' || labelIds === undefined) return draft;
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
    input.defaultStatusKey,
    input.blueprint,
    input.defaultSchedules,
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
  const before = input.template
    ? await resolveVisibleTemplate(orgId, actor.actorId, input.template)
    : null;
  if (input.action !== undefined) return writeCanonicalTemplate(actor, input, before);
  if (
    input.defaultStatusKey !== undefined ||
    input.expectedRevision !== undefined ||
    input.blueprint !== undefined ||
    input.defaultSchedules !== undefined
  )
    invalid('action', 'Choose draft for authoring changes or publish for a reviewed revision.');
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

/** Require a reviewed revision for an existing canonical draft. */
function reviewedRevision(input: DefineTemplateInput): number {
  if (input.expectedRevision === undefined)
    invalid('expectedRevision', 'Choose the revision you reviewed.');
  return input.expectedRevision;
}

/** Refuse fields that a publication or archive operation would otherwise ignore. */
function assertLifecycleInput(input: DefineTemplateInput): void {
  const fields = [
    input.name,
    input.description,
    input.scope,
    input.team,
    input.payload,
    input.labels,
    input.defaultStatusKey,
    input.blueprint,
    input.defaultSchedules,
  ];
  if (fields.some((field) => field !== undefined))
    invalid('action', 'Save draft changes before publishing or archiving.');
}

/** Merge explicit authoring fields into the current unpublished definition. */
async function canonicalDefinition(
  input: DefineTemplateInput,
  before: TemplateRow | null,
  teamId: string | undefined,
): Promise<WorkTemplateDefinition> {
  const payload = await payloadToWrite(input, before, teamId);
  const previous: Partial<WorkTemplateDefinition> = before ? draftOf(before) : {};
  return parsed(WorkTemplateDefinition, {
    ...previous,
    name: input.name ?? previous.name,
    description: input.description ?? previous.description,
    payload: payload ?? previous.payload,
    blueprint: input.blueprint ?? previous.blueprint,
    defaultSchedules: input.defaultSchedules ?? previous.defaultSchedules,
    defaultStatusKey:
      input.defaultStatusKey === undefined ? previous.defaultStatusKey : input.defaultStatusKey,
  });
}

/** Execute explicit authoring operations through the canonical persistence service. */
async function writeCanonicalTemplate(
  actor: McpActor,
  input: DefineTemplateInput,
  before: TemplateRow | null,
): Promise<{ before: TemplateRow | null; after: TemplateRow }> {
  const context = { orgId: input.orgId, actorId: actor.actorId };
  if (input.action === 'publish' || input.action === 'archive') {
    if (!before) invalid('template', 'Choose an existing template.');
    assertLifecycleInput(input);
    const after =
      input.action === 'publish'
        ? await publishWorkTemplate(context, before.id, reviewedRevision(input))
        : await archiveWorkTemplate(context, before.id);
    return { before, after };
  }
  const teamId = await resolveOptional(input.orgId, 'team', input.team, 'team');
  const definition = await canonicalDefinition(input, before, teamId);
  if (before) {
    assertSomethingToChange(input);
    if (input.scope !== undefined || input.team !== undefined)
      invalid('scope', 'Draft edits preserve visibility; publish explicitly to share.');
    return {
      before,
      after: await editWorkTemplateDraft(context, before.id, {
        expectedRevision: reviewedRevision(input),
        definition,
      }),
    };
  }
  const body = parsed(WorkTemplateCreate, {
    targetType: definition.payload.targetType,
    scope: input.scope,
    teamId,
    definition,
  });
  return { before, after: await createWorkTemplate(context, body) };
}

/** Normalize a session proposal with the same definition construction as the actual tool. */
export async function prepareTemplateProposal(
  orgId: string,
  actorId: string,
  raw: unknown,
): Promise<{ definition: WorkTemplateDefinition; input: Record<string, unknown> }> {
  const input = z.object(defineTemplateDefinition.inputSchema).parse(raw);
  if (input.orgId !== orgId || input.action === 'publish' || input.action === 'archive')
    invalid('action', 'Only unpublished template proposals are supported.');
  const before = input.template
    ? await resolveVisibleTemplate(orgId, actorId, input.template)
    : null;
  if (before) requireRevision(before, reviewedRevision(input));
  const definition = await canonicalDefinition(
    { ...input, action: 'draft', scope: undefined, team: undefined },
    before,
    undefined,
  );
  return { definition, input: JSON.parse(JSON.stringify(input)) as Record<string, unknown> };
}

/** Automated writes use the canonical writer and receipt in one checked transaction. */
async function writeAutomatedTemplate(
  ctx: McpContext,
  actor: McpActor,
  input: DefineTemplateInput,
): Promise<{ before: TemplateRow | null; after: TemplateRow; changeSetId: string | null }> {
  await requireAutomatedTemplateAuthor(ctx, actor, input);
  if (input.action === 'publish' || input.action === 'archive')
    invalid('action', 'A person must explicitly publish or archive a template.');
  const selected = input.template
    ? await resolveVisibleTemplate(input.orgId, actor.actorId, input.template)
    : null;
  if (selected) {
    assertSomethingToChange(input);
    requireRevision(selected, reviewedRevision(input));
  }
  const draftInput = { ...input, action: 'draft' as const, scope: undefined, team: undefined };
  const definition = await canonicalDefinition(draftInput, selected, undefined);
  // Editing an existing publication or another visible shared definition creates a separate
  // owner-private draft. Its immutable publication and existing work remain unchanged.
  const before =
    selected?.scope === 'personal' &&
    selected.ownerActorId === actor.actorId &&
    selected.publicationState === 'draft'
      ? selected
      : null;
  const result = await serializableTx(async (tx) => {
    await requireAutomatedTemplateAuthor(ctx, actor, input, tx);
    if (selected && !before) {
      const current = await lockTemplate(tx, actor.orgId, selected.id, actor.actorId);
      requireRevision(current, reviewedRevision(input));
    }
    const creation = before
      ? {
          row: await editWorkTemplateDraftInTransaction(tx, actor, before.id, {
            expectedRevision: reviewedRevision(input),
            definition,
          }),
          effects: [],
        }
      : await createWorkTemplateInTransaction(
          tx,
          actor,
          parsed(WorkTemplateCreate, {
            targetType: definition.payload.targetType,
            scope: 'personal',
            definition,
          }),
        );
    const after = creation.row;
    const changeSetId = await recordChangeSetInTransaction(tx, {
      orgId: actor.orgId,
      actorId: actor.actorId,
      origin: originFor('define_template'),
      summary: `${before ? 'Edited' : 'Created'} template "${definition.name}"`,
      changes: [catalogChange('template', before, after)],
    });
    if (!changeSetId) throw new Error('Template write did not retain a receipt');
    await tx
      .update(changeSet)
      .set({ templateReviewActorId: actor.actorId })
      .where(eq(changeSet.id, changeSetId));
    await writeTemplateProposal(tx, {
      sessionId: registeredTemplateSessionId(ctx),
      orgId: actor.orgId,
      definition,
      input: JSON.parse(JSON.stringify(input)) as Record<string, unknown>,
      applied: { templateId: after.id, revision: after.draftRevision, changeSetId },
    });
    return { before, after, changeSetId, effects: creation.effects };
  });
  if (result.effects.length) await reconcileTemplateCreationEffects(result.effects);
  else await reconcileTemplateImages(actor.orgId, result.after.id, 'upsert');
  return result;
}

/** Flatten a template into the fields its card row compares, with ids turned into names. */
function snapshot(
  row: TemplateRow,
  names: ReadonlyMap<string, string>,
  canonical = false,
): Record<string, unknown> {
  const named = (ids: readonly unknown[]): string =>
    ids.map((id) => nameOf(names, id, String(id))).join(', ');
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
    ...(canonical
      ? {
          publicationState: row.publicationState,
          revision: row.draftRevision,
          version: row.latestPublishedVersionId,
          defaultStatusKey: draftOf(row).defaultStatusKey,
          defaultSchedules: draftOf(row).defaultSchedules,
        }
      : {}),
    scope: row.scope,
    teamId: nameOf(names, row.teamId, 'none'),
    ...Object.fromEntries(draft),
  };
}

/** Render one compared value in full; `fieldDiffs` shortens it only for display. */
function show(_field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none';
  return typeof value === 'string' ? value : JSON.stringify(value);
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
  action: DefineTemplateInput['action'],
): Promise<CatalogRow> {
  const labelIds = [before?.payload, after.payload].flatMap((p) =>
    p?.targetType === 'task' ? (p.labelIds ?? []) : [],
  );
  const [teams, labels] = await Promise.all([
    db.select({ id: team.id, name: team.name }).from(team).where(eq(team.organizationId, orgId)),
    resolveAttachedLabels(orgId, labelIds),
  ]);
  const names = new Map([...teams, ...labels].map((r) => [r.id, r.name]));
  const effective = (row: TemplateRow): TemplateRow =>
    action === 'draft' ? { ...row, ...draftOf(row) } : row;
  const fields = before
    ? fieldDiffs(
        snapshot(effective(before), names, action !== undefined),
        snapshot(effective(after), names, action !== undefined),
        show,
      )
    : [];
  return {
    kind: 'template',
    id: after.id,
    title: effective(after).name,
    href: entityListHref(orgId, 'template'),
    note: noteFor(after, before === null, names),
    matched: before !== null && fields.length === 0,
    fields,
  };
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
      const automated = isAutomatedTemplateContext(ctx);
      const written = automated
        ? await writeAutomatedTemplate(ctx, actor, input)
        : await writeTemplate(actor, input);
      const { before, after } = written;
      const row = await rowFor(input.orgId, before, after, automated ? 'draft' : input.action);
      const changed = !row.matched;
      const changeSetId =
        'changeSetId' in written
          ? written.changeSetId
          : await recordChangeSet({
              orgId: input.orgId,
              actorId: actor.actorId,
              origin: originFor('define_template'),
              summary: `${before ? 'Edited' : 'Created'} template "${after.name}"`,
              changes: changed ? [catalogChange('template', before, after)] : [],
            });
      return jsonResult({
        changed: changed ? 1 : 0,
        revision: after.draftRevision,
        publicationState: after.publicationState,
        workTypeVersionId: after.latestPublishedVersionId,
        listHref: entityListHref(input.orgId, 'template'),
        changes: [row],
        skipped: [],
        changeSetId,
      });
    }),
  );
}
