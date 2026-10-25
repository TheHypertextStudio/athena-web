import { sql } from 'drizzle-orm';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import {
  validateProspectiveBlueprintDefinition,
  type ProspectiveBlueprintSnapshot,
  type ProspectiveBlueprintBinding,
  type ProspectiveBlueprintGraph,
} from '@docket/work/blueprints';
import type { LegacyScheduleImportInput } from '@docket/work/work-schedule-import';
import type { ScheduleArchiveSource } from './work-schedule-archive-source';
import type { WorkScheduleTimingRef } from '@docket/work/work-schedule-field-timing';
import { hashScheduleArchive } from './work-schedule-archive';
import { ScheduleSourceProofError } from './work-schedule-archive-source';
import type { ScheduleConversionPublication } from './work-schedule-conversion-types';
import {
  migrationRows,
  type BlueprintMigrationConnection,
} from './work-template-blueprint-migration/query';

interface Publication extends ProspectiveBlueprintSnapshot {
  readonly workTypeId: string;
  readonly versionId: string;
  readonly definitionHash: string;
}
interface Catalog {
  readonly tx: BlueprintMigrationConnection;
  readonly organizationId: string;
  readonly sources: Map<string, Publication>;
  readonly bindings: ProspectiveBlueprintBinding[];
}
async function loadPublication(
  catalog: Catalog,
  workTypeId: string,
  versionId: string,
): Promise<Publication> {
  const [row] = await migrationRows<{ definition: unknown }>(
    catalog.tx,
    sql`select definition from work_type_version where id=${versionId} and work_type_id=${workTypeId} and organization_id=${catalog.organizationId} for key share`,
  );
  if (!row) throw new ScheduleSourceProofError('closure_unproved');
  const parsed = WorkTemplateDefinition.safeParse(row.definition);
  if (!parsed.success) throw new ScheduleSourceProofError('closure_unproved');
  const definition = parsed.data,
    kind = definition.payload.targetType;
  if (kind !== 'task' && kind !== 'project' && kind !== 'program')
    throw new ScheduleSourceProofError('invalid_structure');
  return {
    sourceKey: versionId,
    definitionKey: workTypeId,
    scopeKey: catalog.organizationId,
    kind,
    definition,
    workTypeId,
    versionId,
    definitionHash: hashScheduleArchive(row.definition),
  };
}
async function readBindings(catalog: Catalog, value: Publication): Promise<void> {
  for (const step of value.definition.blueprint.steps) {
    if (!step.template) continue;
    if (step.template.selection.kind !== 'pinned')
      throw new ScheduleSourceProofError('closure_unproved');
    const target = await read(
      catalog,
      step.template.workTypeId,
      step.template.selection.workTypeVersionId,
    );
    if (target.kind !== step.kind) throw new ScheduleSourceProofError('closure_unproved');
    catalog.bindings.push({
      ownerSourceKey: value.sourceKey,
      stepKey: step.key,
      targetSourceKey: target.sourceKey,
    });
  }
}
async function read(catalog: Catalog, workTypeId: string, versionId: string): Promise<Publication> {
  const previous = catalog.sources.get(versionId);
  if (previous) {
    if (previous.workTypeId !== workTypeId) throw new ScheduleSourceProofError('closure_unproved');
    return previous;
  }
  const value = await loadPublication(catalog, workTypeId, versionId);
  catalog.sources.set(versionId, value);
  if (catalog.sources.size > 500) throw new ScheduleSourceProofError('oversized_source');
  await readBindings(catalog, value);
  return value;
}
/** Exact pinned structural closure and selected logical paths; inline nodes need no fabricated base publication. */
export interface ScheduleConversionClosure {
  readonly selectedWork: LegacyScheduleImportInput['selectedWork'];
  readonly publications: readonly ScheduleConversionPublication[];
  readonly references: ReadonlyMap<string, WorkScheduleTimingRef>;
}
interface ClosureState {
  readonly selectedWork: LegacyScheduleImportInput['selectedWork'];
  readonly publications: ScheduleConversionPublication[];
  readonly references: Map<string, WorkScheduleTimingRef>;
}
type Root = ScheduleArchiveSource['manifest']['roots'][number];
function canonicalReferences(
  source: ScheduleArchiveSource,
  root: Root,
  graph: ProspectiveBlueprintGraph,
): Map<string, WorkScheduleTimingRef> {
  const references = new Map<string, WorkScheduleTimingRef>();
  for (const step of source.manifest.steps.filter((step) => step.rootKey === root.key)) {
    if (!step.path.length) {
      references.set(step.sourceStepId, { rootKey: root.key, path: [] });
      continue;
    }
    const proof = source.originalStepOrders.find(
      (entry) => entry.sourceStepId === step.sourceStepId,
    );
    if (!proof) throw new ScheduleSourceProofError('closure_unproved');
    const matches = graph.nodes.filter(
      (node) => node.ownerSourceKey === proof.sourceVersionId && node.sourceStepKey === proof.key,
    );
    const node = matches[0];
    if (matches.length !== 1 || !node) throw new ScheduleSourceProofError('closure_unproved');
    references.set(step.sourceStepId, { rootKey: root.key, path: [...node.path] });
  }
  return references;
}
function includedNode(
  node: ProspectiveBlueprintGraph['nodes'][number],
  selected: ReadonlyMap<string, boolean>,
): boolean {
  return (
    (node.parentPath === null || selected.get(JSON.stringify(node.parentPath)) === true) &&
    (node.step?.optional.selectedByDefault ?? true)
  );
}
function appendNodes(
  catalog: Catalog,
  state: ClosureState,
  rootKey: string,
  nodes: ProspectiveBlueprintGraph['nodes'],
): void {
  const selected = new Map<string, boolean>();
  for (const node of nodes) {
    const included = includedNode(node, selected);
    selected.set(JSON.stringify(node.path), included);
    if (!included) continue;
    if (node.kind !== 'task' && node.kind !== 'project' && node.kind !== 'milestone')
      throw new ScheduleSourceProofError('invalid_structure');
    state.selectedWork.push({ reference: { rootKey, path: [...node.path] }, kind: node.kind });
    if (state.selectedWork.length > 500) throw new ScheduleSourceProofError('oversized_source');
    if (!node.selectedSourceKey) continue;
    const publication = catalog.sources.get(node.selectedSourceKey);
    if (!publication) throw new ScheduleSourceProofError('closure_unproved');
    state.publications.push({
      rootKey,
      path: [...node.path],
      workTypeId: publication.workTypeId,
      versionId: publication.versionId,
      definitionHash: publication.definitionHash,
    });
  }
}
/**
 * Read immutable pinned publication structure without resolving current/latest choices or physical work.
 * @throws For absent/ambiguous selections, loops, unsupported structure or the selected-work bound.
 */
export async function readScheduleConversionClosure(
  tx: BlueprintMigrationConnection,
  organizationId: string,
  source: ScheduleArchiveSource,
): Promise<ScheduleConversionClosure> {
  const catalog: Catalog = { tx, organizationId, sources: new Map(), bindings: [] };
  const state: ClosureState = { selectedWork: [], publications: [], references: new Map() };
  for (const root of source.manifest.roots) {
    if (!root.workTypeId || !root.workTypeVersionId)
      throw new ScheduleSourceProofError('missing_selection');
    const publication = await read(catalog, root.workTypeId, root.workTypeVersionId);
    if (publication.kind !== root.kind) throw new ScheduleSourceProofError('closure_unproved');
    const graph = validateProspectiveBlueprintDefinition({
      root: publication,
      sources: [...catalog.sources.values()],
      bindings: catalog.bindings,
    });
    for (const [alias, reference] of canonicalReferences(source, root, graph))
      state.references.set(alias, reference);
    appendNodes(catalog, state, root.key, graph.nodes);
  }
  return state;
}
