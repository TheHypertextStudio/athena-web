import { template, workTypeTeam } from '@docket/db';
import type {
  PublishedBlueprintSnapshot,
  ResolvedBlueprintGraph,
  WorkKind,
} from '@docket/work/blueprints';
import { BlueprintStepId } from '@docket/work/ids';
import type { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { ConflictError, ValidationError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import {
  resolveBlueprintCatalog,
  resolveRetainedBlueprintCatalog,
  type BlueprintPublicationReader,
} from './catalog';
import {
  retainedResolutionManifest,
  type RetainedBlueprintResolutionProof,
} from './resolution-retained';
import { blueprintFingerprint } from './fingerprint';
import { readBlueprintPublication } from './publication-read';
import { publicationDefinitionIds } from './publication';

/** Authored steps beneath a root, verified by the private publication factory in this transaction. */
export interface PrivateBlueprintStructure {
  readonly invocationId: string;
  readonly definition: WorkTemplateDefinition;
  readonly stepAliases: Readonly<Record<string, string>>;
}

/** Root selection derived from a validated ordinary create, publication, or retained series binding. */
export interface BlueprintSelection {
  readonly organizationId: string;
  readonly kind: WorkKind;
  readonly workTypeId?: string | undefined;
  readonly workTypeVersionId?: string | undefined;
  /** Replaces the selected base root's structure; its identity stays the base publication. */
  readonly privateStructure?: PrivateBlueprintStructure | undefined;
}

function privateRoot(
  root: PublishedBlueprintSnapshot,
  structure: PrivateBlueprintStructure | undefined,
): PublishedBlueprintSnapshot {
  if (!structure) return root;
  if (root.definition.blueprint.steps.length)
    throw new ConflictError('Private structure requires a base publication.');
  return {
    ...root,
    definition: structure.definition,
    stepIds: Object.fromEntries(
      Object.entries(structure.stepAliases).map(([key, alias]) => [
        key,
        BlueprintStepId.parse(alias),
      ]),
    ),
    privateInvocationId: structure.invocationId,
  };
}

/** Internal invocation policy; clients cannot supply publication or archive-binding authority. */
export type BlueprintResolutionMode = 'create' | 'publish' | 'retained_schedule';

/** Frozen closure plus destination offerings checked after parent/team rules resolve. */
export interface ResolvedBlueprintClosure extends ResolvedBlueprintGraph {
  readonly offerings: readonly {
    readonly workTypeId: string;
    readonly teamIds: readonly string[];
  }[];
}

async function discover(
  tx: TemplateTransaction,
  selection: BlueprintSelection,
  mode: BlueprintResolutionMode,
  retainedRootVersionId?: string | null,
  retainedProof?: RetainedBlueprintResolutionProof,
): Promise<ResolvedBlueprintGraph> {
  if (selection.privateStructure && mode === 'publish')
    throw new ConflictError('Template selection changed');
  const root = privateRoot(
    await readBlueprintPublication(tx, selection, {
      archived: mode === 'retained_schedule',
      draft: mode === 'publish',
    }),
    selection.privateStructure,
  );
  if (mode === 'publish') {
    const [row] = await tx
      .select()
      .from(template)
      .where(
        and(
          eq(template.organizationId, selection.organizationId),
          eq(template.id, root.workTypeId),
        ),
      )
      .limit(1);
    if (!row) throw new ConflictError('Template selection changed');
    await publicationDefinitionIds(tx, row, root.definition, retainedRootVersionId);
  }
  const read: BlueprintPublicationReader = (kind, reference, exactVersionId) =>
    readBlueprintPublication(
      tx,
      {
        organizationId: selection.organizationId,
        kind,
        workTypeId: reference?.workTypeId,
        workTypeVersionId:
          reference?.selection.kind === 'pinned'
            ? reference.selection.workTypeVersionId
            : exactVersionId,
      },
      { archived: true, draft: false },
    );
  if (retainedProof) {
    if (mode !== 'retained_schedule') throw new ConflictError('Template selection changed');
    return resolveRetainedBlueprintCatalog(
      root,
      retainedResolutionManifest(tx, selection, retainedProof),
      read,
    );
  }
  return resolveBlueprintCatalog(root, read, mode === 'publish' ? 'publication' : 'creation');
}

function definitionIds(graph: ResolvedBlueprintGraph): string[] {
  return [...new Set([graph.root, ...graph.publications].map((row) => row.workTypeId))].sort();
}

interface ClosureRead {
  readonly tx: TemplateTransaction;
  readonly selection: BlueprintSelection;
  readonly mode: BlueprintResolutionMode;
  readonly retainedRootVersionId: string | null | undefined;
  readonly retainedProof: RetainedBlueprintResolutionProof | undefined;
}
const closureReads = new WeakMap<ResolvedBlueprintClosure, ClosureRead>();

/** Read a validated immutable closure without locking, for a complete read-first forest preflight. */
export async function readBlueprintClosure(
  tx: TemplateTransaction,
  selection: BlueprintSelection,
  mode: BlueprintResolutionMode = 'create',
  retainedRootVersionId?: string | null,
  retainedProof?: RetainedBlueprintResolutionProof,
): Promise<ResolvedBlueprintClosure> {
  if (selection.workTypeVersionId && !selection.workTypeId)
    throw new ValidationError([
      { path: ['workTypeVersionId'], message: 'Choose the template together with its version.' },
    ]);
  if (mode === 'publish' && !selection.workTypeVersionId)
    throw new ConflictError('Publication requires an exact version');
  const graph = await discover(tx, selection, mode, retainedRootVersionId, retainedProof);
  const ids = definitionIds(graph);
  const definitions = await tx
    .select({
      id: template.id,
      revision: template.draftRevision,
      state: template.publicationState,
      archivedAt: template.archivedAt,
    })
    .from(template)
    .where(and(eq(template.organizationId, selection.organizationId), inArray(template.id, ids)))
    .orderBy(asc(template.id));
  if (definitions.length !== ids.length) throw new ConflictError('Template selection changed');
  const offerings = await closureOfferings(tx, selection.organizationId, ids);
  const closure = {
    ...graph,
    offerings,
    fingerprint: blueprintFingerprint({ graph, offerings, definitions }),
  };
  closureReads.set(closure, {
    tx,
    selection: { ...selection },
    mode,
    retainedRootVersionId,
    retainedProof,
  });
  return closure;
}

async function closureOfferings(tx: TemplateTransaction, orgId: string, ids: readonly string[]) {
  const offered = await tx
    .select({ workTypeId: workTypeTeam.workTypeId, teamId: workTypeTeam.teamId })
    .from(workTypeTeam)
    .where(and(eq(workTypeTeam.organizationId, orgId), inArray(workTypeTeam.workTypeId, [...ids])))
    .orderBy(asc(workTypeTeam.workTypeId), asc(workTypeTeam.teamId));
  return ids.map((workTypeId) => ({
    workTypeId,
    teamIds: offered.filter((row) => row.workTypeId === workTypeId).map((row) => row.teamId),
  }));
}

/** Lock all read-first forest closures globally sorted, then refuse any changed graph or offering. */
export async function lockBlueprintClosures(
  tx: TemplateTransaction,
  graphs: readonly ResolvedBlueprintClosure[],
): Promise<void> {
  if (graphs.length === 0) return;
  const reads = graphs.map((graph) => {
    const read = closureReads.get(graph);
    if (read?.tx !== tx) throw new ConflictError('Template selection changed');
    return read;
  });
  const orgId = reads[0]?.selection.organizationId;
  if (!orgId || reads.some((read) => read.selection.organizationId !== orgId))
    throw new ConflictError('Template selection changed');
  const ids = [...new Set(graphs.flatMap(definitionIds))].sort();
  const locked = await tx
    .select({ id: template.id })
    .from(template)
    .where(and(eq(template.organizationId, orgId), inArray(template.id, ids)))
    .orderBy(asc(template.id))
    .for('update');
  if (locked.length !== ids.length) throw new ConflictError('Template selection changed');
  for (const graph of graphs) {
    const read = closureReads.get(graph);
    if (!read) throw new ConflictError('Template selection changed');
    const checked = await readBlueprintClosure(
      tx,
      read.selection,
      read.mode,
      read.retainedRootVersionId,
      read.retainedProof,
    );
    if (checked.fingerprint !== graph.fingerprint)
      throw new ConflictError('Template selection changed');
  }
}

/** Resolve and lock one authorized closure inside the caller's SERIALIZABLE transaction. */
export async function resolveBlueprintClosure(
  tx: TemplateTransaction,
  selection: BlueprintSelection,
  mode: BlueprintResolutionMode = 'create',
  retainedRootVersionId?: string | null,
  retainedProof?: RetainedBlueprintResolutionProof,
): Promise<ResolvedBlueprintClosure> {
  const graph = await readBlueprintClosure(
    tx,
    selection,
    mode,
    retainedRootVersionId,
    retainedProof,
  );
  await lockBlueprintClosures(tx, [graph]);
  return graph;
}
