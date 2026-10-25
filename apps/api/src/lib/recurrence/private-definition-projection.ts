import type { InvocationRevisionProjection } from '@docket/db';
import type { CanonicalPrivateWorkDefinition } from '@docket/work/work-private-definition';
import { ProcessDefinitionCreate, ProcessRevisionOut } from '../../contracts/recurrence';
import { ConflictError } from '../../error';

/** Immutable canonical alias/audit facts needed for exact compatibility readback. */
export interface PrivateDefinitionRevisionProjection {
  readonly id: string;
  readonly headId: string;
  readonly number: number;
  readonly state: 'published' | 'pending_draft';
  readonly creationMode: 'all_at_once' | 'when_ready';
  readonly projection: InvocationRevisionProjection;
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
}
function assertAliases(
  revision: PrivateDefinitionRevisionProjection,
  document: CanonicalPrivateWorkDefinition,
  definition: Pick<ProcessDefinitionCreate, 'project' | 'tasks' | 'milestones'>,
): void {
  const expected = [
    ...(definition.project ? [{ key: definition.project.key, kind: 'project', sort: 0 }] : []),
    ...definition.milestones.map((step) => ({ key: step.key, kind: 'milestone', sort: step.sort })),
    ...definition.tasks.map((step, sort) => ({ key: step.key, kind: 'task', sort })),
  ];
  const valid =
    revision.projection.steps.length === expected.length &&
    expected.length === document.sourceMappings.length &&
    expected.every((source) => {
      const mapped = document.sourceMappings.filter((entry) => entry.sourceKey === source.key),
        projection = revision.projection.steps.filter((entry) => entry.key === source.key);
      const mapping = mapped[0],
        alias = projection[0];
      return (
        mapped.length === 1 &&
        projection.length === 1 &&
        mapping?.kind === source.kind &&
        mapping.sort === source.sort &&
        alias?.alias === mapping.alias &&
        alias.kind === mapping.kind &&
        alias.sort === mapping.sort &&
        alias.rootKey === mapping.reference.rootKey &&
        JSON.stringify(alias.path) === JSON.stringify(mapping.reference.path)
      );
    });
  if (!valid) throw new ConflictError('Private revision aliases are unavailable.');
}
function privateSource(
  revision: PrivateDefinitionRevisionProjection,
  document: CanonicalPrivateWorkDefinition,
): Readonly<Record<string, unknown>> {
  if (
    document.authoring.definitionAlias !== revision.headId ||
    document.authoring.revisionAlias !== revision.id ||
    document.state !== revision.state ||
    document.creationMode !== revision.creationMode ||
    (revision.state === 'published') !== (revision.publishedAt !== null)
  )
    throw new ConflictError('Private authored revision is unavailable.');
  const source = document.authoring.definition;
  if (!source || typeof source !== 'object' || Array.isArray(source))
    throw new ConflictError('Private authored revision is unavailable.');
  if (revision.state === 'published') {
    const definition = ProcessDefinitionCreate.safeParse(source);
    if (!definition.success || definition.data.creationMode !== revision.creationMode)
      throw new ConflictError('Private authored publication is unavailable.');
  }
  return source;
}
/**
 * Project exact strictly validated authored input; derived field rules never reconstruct original timing or prose.
 * Current private-head access and the immutable raw payload hash are verified by the owning read service first.
 * @throws {ConflictError} For mismatched aliases, state, source shape or publication audit facts.
 */
export function projectPrivateDefinitionRevision(
  revision: PrivateDefinitionRevisionProjection,
  document: CanonicalPrivateWorkDefinition,
): ProcessRevisionOut {
  const source = privateSource(revision, document);
  const parsed = ProcessRevisionOut.safeParse({
    id: revision.id,
    definitionId: revision.headId,
    number: revision.number,
    creationMode: revision.creationMode,
    project: source['project'],
    tasks: source['tasks'] ?? [],
    milestones: source['milestones'] ?? [],
    dependencies: source['dependencies'] ?? [],
    createdAt: revision.createdAt.toISOString(),
    publishedAt: revision.publishedAt?.toISOString() ?? null,
  });
  if (!parsed.success) throw new ConflictError('Private authored revision is unavailable.');
  assertAliases(revision, document, parsed.data);
  return parsed.data;
}
