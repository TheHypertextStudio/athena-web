import { blueprintStep } from '@docket/db';
import { ResolvedVersionAtPath } from '@docket/work/work-template-blueprint';
import { and, eq, inArray } from 'drizzle-orm';
import { ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import {
  requireRetainedOccurrenceAuthority,
  type RetainedRootBinding,
} from '../work-creation/retained-authority';
import {
  loadRetainedBlueprintResolutionProof,
  retainedResolutionManifest,
} from './resolution-retained';
import type { AuthorizedBlueprintSnapshot } from './snapshot-types';
interface SourceProjection {
  readonly id: string;
  readonly versionId: string;
  readonly key: string;
  readonly kind: string;
  readonly parentStepKey: string | null;
}
/** Opaque original closure and observed immutable projections, registered to one exact transaction/binding. */
export interface RetainedBlueprintLineage {
  readonly proof: object;
}
interface CheckedLineage {
  readonly tx: TemplateTransaction;
  readonly binding: RetainedRootBinding;
  readonly organizationId: string;
  readonly accepted: ReadonlyMap<string, ResolvedVersionAtPath>;
  readonly selectedWork: ReadonlyMap<string, { readonly kind: string; readonly id: string }>;
  readonly projections: Map<string, SourceProjection>;
}
const checkedLineages = new WeakMap<RetainedBlueprintLineage, CheckedLineage>();
function requireLineage(tx: TemplateTransaction, token: RetainedBlueprintLineage): CheckedLineage {
  const lineage = checkedLineages.get(token);
  if (lineage?.tx !== tx) throw new ConflictError('Retained lineage changed');
  requireRetainedOccurrenceAuthority(tx, lineage.binding.authority);
  return lineage;
}
/** Read the service's checked original closure, independently of later foreground template generations. */
export async function loadRetainedBlueprintLineage(
  tx: TemplateTransaction,
  binding: RetainedRootBinding,
): Promise<RetainedBlueprintLineage> {
  const facts = requireRetainedOccurrenceAuthority(tx, binding.authority);
  const selected = facts.manifest.roots.find((root) => root.key === binding.rootKey);
  if (!selected?.workTypeId || !selected.workTypeVersionId)
    throw new ConflictError('Retained root mapping changed');
  const selection = {
    organizationId: facts.organizationId,
    kind: selected.kind,
    workTypeId: selected.workTypeId,
    workTypeVersionId: selected.workTypeVersionId,
  };
  const proof = await loadRetainedBlueprintResolutionProof(tx, binding);
  const manifest = proof
    ? retainedResolutionManifest(tx, selection, proof)
    : [
        ResolvedVersionAtPath.parse({
          path: [],
          workTypeId: selected.workTypeId,
          versionId: selected.workTypeVersionId,
        }),
      ];
  const token = Object.freeze({ proof: {} });
  checkedLineages.set(token, {
    tx,
    binding,
    organizationId: facts.organizationId,
    accepted: new Map(manifest.map((entry) => [JSON.stringify(entry.path), entry])),
    selectedWork: new Map(
      (facts.rootRefs.find((root) => root.key === selected.sourceKey)?.selectedWork ?? []).map(
        (entry) => [JSON.stringify(entry.path), { kind: entry.kind, id: entry.id }],
      ),
    ),
    projections: new Map(),
  });
  return token;
}
/** Load only observed exact source IDs; never read unrelated publication steps or their private documents. */
export async function loadRetainedSnapshotLineage(
  tx: TemplateTransaction,
  token: RetainedBlueprintLineage,
  snapshot: AuthorizedBlueprintSnapshot,
): Promise<void> {
  const lineage = requireLineage(tx, token);
  const versions = new Set<string>([...lineage.accepted.values()].map((entry) => entry.versionId));
  const ids = [
    ...new Set(
      [...snapshot.rowsByRef.values()].flatMap(({ row }) =>
        row.blueprintStepId &&
        row.blueprintSourceVersionId &&
        versions.has(row.blueprintSourceVersionId) &&
        !lineage.projections.has(row.blueprintStepId)
          ? [row.blueprintStepId]
          : [],
      ),
    ),
  ];
  if (!ids.length) return;
  const projections = await tx
    .select({
      id: blueprintStep.id,
      versionId: blueprintStep.versionId,
      key: blueprintStep.key,
      kind: blueprintStep.kind,
      parentStepKey: blueprintStep.parentStepKey,
    })
    .from(blueprintStep)
    .where(
      and(eq(blueprintStep.organizationId, lineage.organizationId), inArray(blueprintStep.id, ids)),
    );
  for (const projection of projections) lineage.projections.set(projection.id, projection);
}
function projectionMatches(
  projection: SourceProjection | undefined,
  origin: { readonly version: string; readonly kind: string; readonly key: string | undefined },
): projection is SourceProjection {
  return (
    projection?.versionId === origin.version &&
    projection.kind === origin.kind &&
    projection.key === origin.key
  );
}
function isSelectedWork(
  lineage: CheckedLineage,
  row: { readonly id: string; readonly kind: string },
  path: readonly string[],
): boolean {
  const selected = lineage.selectedWork.get(JSON.stringify(path));
  return selected?.kind === row.kind && selected.id === row.id;
}
/** Require the original selected row identity, path, publication and source step before adopting a descendant. */
export function retainedManagedParentPath(
  tx: TemplateTransaction,
  token: RetainedBlueprintLineage,
  row: {
    readonly id: string;
    readonly kind: string;
    readonly blueprintPath: readonly string[] | null;
    readonly blueprintStepId: string | null;
    readonly blueprintSourceVersionId: string | null;
  },
): readonly string[] | null {
  const lineage = requireLineage(tx, token);
  const path = row.blueprintPath;
  if (!path?.length || !row.blueprintStepId || !row.blueprintSourceVersionId) return null;
  if (!isSelectedWork(lineage, row, path)) return null;
  const scope = path.slice(0, -1);
  const publication = lineage.accepted.get(JSON.stringify(scope));
  const projection = lineage.projections.get(row.blueprintStepId);
  if (
    publication?.versionId !== row.blueprintSourceVersionId ||
    !projectionMatches(projection, {
      version: row.blueprintSourceVersionId,
      kind: row.kind,
      key: path.at(-1),
    })
  )
    return null;
  if (row.kind !== 'milestone' && !lineage.accepted.has(JSON.stringify(path))) return null;
  return projection.parentStepKey ? [...scope, projection.parentStepKey] : scope;
}
