import { isDeepStrictEqual } from 'node:util';
import { template, workTypeVersion } from '@docket/db';
import {
  discoverPublicationReferences,
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
  readonly retained: ReadonlyMap<string, BlueprintStep>;
  readonly cache: Map<string, Promise<PublishedBlueprintSnapshot>>;
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
    retained: await previousSteps(tx, row, retainedVersionId),
    cache: new Map(),
  };
  return discoverPublicationReferences(
    row.id,
    WorkTemplateDefinition.parse(definition),
    (kind, reference, path, scheduleRoot) => {
      const step = definition.blueprint.steps.find((entry) => entry.key === path[0]);
      const archived =
        !scheduleRoot && (path.length > 1 || (step ? retainedStep(state, step) : false));
      return readDraftChild(state, kind, reference, archived);
    },
  );
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
