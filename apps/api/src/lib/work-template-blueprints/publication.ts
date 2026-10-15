import { isDeepStrictEqual } from 'node:util';
import { template, workTypeVersion } from '@docket/db';
import {
  BlueprintError,
  type PublishedBlueprintSnapshot,
  type WorkKind,
} from '@docket/work/blueprints';
import type { BlueprintStep } from '@docket/work/work-template-blueprint';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '../../error';
import type { TemplateRow } from '../templates/model';
import type { TemplateTransaction } from '../templates/persistence';
import { visibleTemplateWhere } from '../templates/visibility';
import { readBlueprintPublication } from './publication-read';

interface Discovery {
  readonly tx: TemplateTransaction;
  readonly row: TemplateRow;
  readonly ids: Set<string>;
  readonly retained: ReadonlyMap<string, BlueprintStep>;
  readonly cache: Map<string, Promise<PublishedBlueprintSnapshot>>;
  count: number;
}

/** Read the authorized draft before acquiring globally ordered publication locks. */
export async function readPublicationDraft(
  tx: TemplateTransaction,
  orgId: string,
  id: string,
  actorId: string,
): Promise<TemplateRow> {
  const [row] = await tx
    .select()
    .from(template)
    .where(visibleTemplateWhere(orgId, actorId, { id, includeArchived: true, includeBase: true }))
    .limit(1);
  if (!row) throw new NotFoundError('Template not found');
  return row;
}

async function previousSteps(
  tx: TemplateTransaction,
  row: TemplateRow,
  retainedVersionId: string | null,
): Promise<ReadonlyMap<string, BlueprintStep>> {
  if (!retainedVersionId) return new Map();
  const [previous] = await tx
    .select({ definition: workTypeVersion.definition })
    .from(workTypeVersion)
    .where(
      and(
        eq(workTypeVersion.organizationId, row.organizationId),
        eq(workTypeVersion.workTypeId, row.id),
        eq(workTypeVersion.id, retainedVersionId),
      ),
    )
    .limit(1);
  if (!previous) throw new NotFoundError('Template version not found');
  return new Map(
    WorkTemplateDefinition.parse(previous.definition).blueprint.steps.map((step) => [
      step.key,
      step,
    ]),
  );
}

function retainedStep(state: Discovery, step: BlueprintStep): boolean {
  const previous = state.retained.get(step.key);
  return previous?.kind === step.kind && isDeepStrictEqual(previous.template, step.template);
}

function readDraftChild(
  state: Discovery,
  kind: WorkKind,
  reference: BlueprintStep['template'],
  archived: boolean,
): Promise<PublishedBlueprintSnapshot> {
  const key = JSON.stringify([kind, reference, archived]);
  const existing = state.cache.get(key);
  if (existing) return existing;
  const pending = readBlueprintPublication(
    state.tx,
    {
      organizationId: state.row.organizationId,
      kind,
      workTypeId: reference?.workTypeId,
      workTypeVersionId:
        reference?.selection.kind === 'pinned' ? reference.selection.workTypeVersionId : undefined,
    },
    { archived, draft: false },
  );
  state.cache.set(key, pending);
  return pending;
}

async function visitDraftScope(
  state: Discovery,
  definition: WorkTemplateDefinition,
  path: readonly string[],
  ancestors: readonly string[],
): Promise<void> {
  for (const step of definition.blueprint.steps) {
    if (++state.count > 500)
      throw new BlueprintError(
        'blueprint_limit',
        'Blueprint limit is 500 work rows including the root and Milestones.',
      );
    if (step.kind === 'milestone') continue;
    const child = await readDraftChild(
      state,
      step.kind,
      step.template,
      path.length > 0 || retainedStep(state, step),
    );
    state.ids.add(child.workTypeId);
    if (!step.template) continue;
    const childPath = [...path, step.key];
    if (ancestors.includes(child.workTypeId))
      throw new BlueprintError(
        'blueprint_loop',
        'A nested template references its own template identity.',
        [childPath],
      );
    await visitDraftScope(state, child.definition, childPath, [...ancestors, child.workTypeId]);
  }
}

/** Discover real immutable references from a draft without inventing a prospective version ID. */
export async function publicationDefinitionIds(
  tx: TemplateTransaction,
  row: TemplateRow,
  definition: WorkTemplateDefinition,
  retainedVersionId: string | null = row.latestPublishedVersionId,
): Promise<string[]> {
  const state: Discovery = {
    tx,
    row,
    ids: new Set([row.id]),
    retained: await previousSteps(tx, row, retainedVersionId),
    cache: new Map(),
    count: 1,
  };
  await visitDraftScope(state, WorkTemplateDefinition.parse(definition), [], [row.id]);
  return [...state.ids].sort();
}

/** Lock the proposed root and existing closure globally sorted, before draft/version mutation. */
export async function lockPublicationClosure(
  tx: TemplateTransaction,
  row: TemplateRow,
  definition: WorkTemplateDefinition = row.draftDefinition,
  retainedVersionId: string | null = row.latestPublishedVersionId,
): Promise<TemplateRow> {
  const ids = await publicationDefinitionIds(tx, row, definition, retainedVersionId);
  const locked = await tx
    .select()
    .from(template)
    .where(and(eq(template.organizationId, row.organizationId), inArray(template.id, ids)))
    .orderBy(asc(template.id))
    .for('update');
  const current = locked.find((entry) => entry.id === row.id);
  if (
    locked.length !== ids.length ||
    current?.draftRevision !== row.draftRevision ||
    current.latestPublishedVersionId !== row.latestPublishedVersionId
  )
    throw new ConflictError('Template selection changed');
  const checked = await publicationDefinitionIds(tx, current, definition, retainedVersionId);
  if (!isDeepStrictEqual(checked, ids)) throw new ConflictError('Template selection changed');
  return current;
}
