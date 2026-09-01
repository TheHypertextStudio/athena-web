/**
 * `@docket/api` — resolve the external thing an activity event is about to the Docket entity that
 * mirrors it.
 *
 * @remarks
 * The artifact half of association. {@link resolveExternalActor} answers "which Docket person is
 * this?"; this answers "which Docket task/project/cycle is this?". Both are read-only.
 *
 * Batched by construction: the caller hands over every reference in one delivery and gets one map
 * back. The per-reference shape it replaces ran one query per participant per event, and a
 * single-ref signature would invite that back the moment a second call site appears.
 *
 * Only three kinds are resolvable, because only three tables carry mirror provenance
 * (`source='linked'` plus `(sourceIntegrationId, externalId)`): `task`, `project` and `cycle`. A
 * kind with no Docket representation is not a failure to look it up — there is nothing to look up —
 * and {@link MIRROR_LOOKUP} records that decision per kind rather than leaving it implied.
 */
import { cycle, db, project, task } from '@docket/db';
import type { CanonicalEntityKind } from '@docket/connections/event-contract';
import { and, eq, inArray } from 'drizzle-orm';

/** One external reference to resolve. */
export interface ExternalEntityRef {
  /** The canonical kind the adapter mapped this onto. */
  readonly kind: CanonicalEntityKind;
  /** The thing's native id in the source system. */
  readonly externalId: string;
}

/** The tenancy the mirror must belong to — an event resolves only within its own integration. */
export interface ExternalEntityScope {
  readonly organizationId: string;
  readonly integrationId: string;
}

/**
 * Resolved Docket ids, keyed by {@link externalEntityKey}.
 *
 * @remarks
 * A reference that resolved to nothing is absent rather than mapped to null, so there is no
 * "present but empty" state for a caller to mishandle.
 */
export type ResolvedEntities = ReadonlyMap<string, string>;

/** One mirror row: the Docket id and the external id it was matched on. */
interface MirrorRow {
  readonly id: string;
  readonly externalId: string | null;
}

/** Look up mirrors of one kind, scoped to an integration. */
type MirrorLookup = (
  scope: ExternalEntityScope,
  externalIds: readonly string[],
) => Promise<MirrorRow[]>;

const lookupTasks: MirrorLookup = (scope, externalIds) =>
  db
    .select({ id: task.id, externalId: task.externalId })
    .from(task)
    .where(
      and(
        eq(task.organizationId, scope.organizationId),
        eq(task.sourceIntegrationId, scope.integrationId),
        eq(task.source, 'linked'),
        inArray(task.externalId, [...externalIds]),
      ),
    );

const lookupProjects: MirrorLookup = (scope, externalIds) =>
  db
    .select({ id: project.id, externalId: project.externalId })
    .from(project)
    .where(
      and(
        eq(project.organizationId, scope.organizationId),
        eq(project.sourceIntegrationId, scope.integrationId),
        eq(project.source, 'linked'),
        inArray(project.externalId, [...externalIds]),
      ),
    );

const lookupCycles: MirrorLookup = (scope, externalIds) =>
  db
    .select({ id: cycle.id, externalId: cycle.externalId })
    .from(cycle)
    .where(
      and(
        eq(cycle.organizationId, scope.organizationId),
        eq(cycle.sourceIntegrationId, scope.integrationId),
        eq(cycle.source, 'linked'),
        inArray(cycle.externalId, [...externalIds]),
      ),
    );

/**
 * Which table mirrors each canonical kind, or `null` when Docket has no representation for it.
 *
 * @remarks
 * Total over {@link CanonicalEntityKind} on purpose: a new kind is a compile error here, forcing
 * whoever adds it to say whether it can be associated. A `Partial` record would let a new kind
 * silently become permanently unresolvable.
 */
const MIRROR_LOOKUP: Record<CanonicalEntityKind, MirrorLookup | null> = {
  work_item: lookupTasks,
  project: lookupProjects,
  cycle: lookupCycles,
  // Docket-native concepts — no provider mirrors them, so there is no external id to match on.
  program: null,
  initiative: null,
  agent_session: null,
  organization: null,
  // Conversation and document surfaces Docket observes but does not mirror as entities.
  thread: null,
  message: null,
  document: null,
  calendar_event: null,
  person: null,
};

/** Whether Docket could ever mirror this kind — the difference between "retry later" and "never". */
export function isAssociableKind(kind: CanonicalEntityKind): boolean {
  return MIRROR_LOOKUP[kind] !== null;
}

/** The map key for one reference. `\0` cannot occur in a provider id, so it cannot collide. */
export function externalEntityKey(kind: CanonicalEntityKind, externalId: string): string {
  return `${kind}\0${externalId}`;
}

/**
 * Resolve every reference in one delivery to the Docket entity mirroring it.
 *
 * @param scope - The organization and integration the mirrors must belong to.
 * @param refs - The references to resolve; duplicates and unassociable kinds are handled here.
 * @returns a map from {@link externalEntityKey} to Docket id, omitting anything unresolved.
 */
export async function resolveExternalEntities(
  scope: ExternalEntityScope,
  refs: readonly ExternalEntityRef[],
): Promise<ResolvedEntities> {
  const byKind = new Map<CanonicalEntityKind, Set<string>>();
  for (const ref of refs) {
    if (!isAssociableKind(ref.kind)) {
      continue;
    }
    const ids = byKind.get(ref.kind) ?? new Set<string>();
    ids.add(ref.externalId);
    byKind.set(ref.kind, ids);
  }

  const resolved = new Map<string, string>();
  // One query per distinct kind, not per reference. Kinds are independent, so they run together.
  await Promise.all(
    [...byKind].map(async ([kind, ids]) => {
      const lookup = MIRROR_LOOKUP[kind];
      if (!lookup) {
        return;
      }
      for (const row of await lookup(scope, [...ids])) {
        if (row.externalId) {
          resolved.set(externalEntityKey(kind, row.externalId), row.id);
        }
      }
    }),
  );
  return resolved;
}
