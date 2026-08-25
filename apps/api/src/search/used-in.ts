/**
 * `@docket/api` — resolve which work each resource is actually used by.
 *
 * @remarks
 * The Library's central browse dimension. A reference count says a document is popular. The Q3
 * launch says what the document is for.
 *
 * The data is already there. Prose links use `mention` rows. Attachments carry their host subject
 * directly. Nothing here adds a table or a write path.
 *
 * Everything is batched per page. A per-row query here would be one round trip per resource on
 * every Library render and every palette keystroke.
 */
import { and, eq, inArray, or } from 'drizzle-orm';
import type { SearchDocumentKind, SearchUsedIn } from '@docket/types';

/** The kinds this module will name as a container, shallowest last. */
type ContainerKind = SearchUsedIn['kind'];

/**
 * Container altitude, lowest number wins.
 *
 * @remarks
 * The resolver keeps every candidate through visibility filtering, then uses this order to select
 * the highest visible level. A document referenced from eleven tasks can therefore read "Q3
 * launch" without leaking a hidden initiative or losing a visible project fallback.
 *
 * Initiative outranks program outranks project because that is the order a person describes their
 * own work in — nobody says "the API surface freeze document" when they mean the launch's.
 */
const CONTAINER_ALTITUDE: Record<ContainerKind, number> = {
  initiative: 0,
  program: 1,
  project: 2,
  team: 3,
};

/**
 * The visibility gate this module filters through, supplied by the caller.
 *
 * @remarks
 * Injected rather than imported because `query.ts` already imports this module, and the one true
 * implementation — `loadVisibleDocuments` — lives there. Declaring the dependency keeps the single
 * visibility filter single, without an import cycle and without a second copy.
 *
 * Given entity ids, returns the subset the caller may see.
 */
export type VisibleEntityLookup = (
  organizationId: string,
  entityIds: readonly string[],
) => Promise<ReadonlySet<string>>;

/** A row this module resolves containers for. */
export interface UsedInTarget {
  /** The `search_document.id`, used only to key the result map. */
  readonly documentId: string;
  /** The row's semantic kind, which selects which mention arm to match. */
  readonly kind: SearchDocumentKind;
  /** The source entity id represented by this search document. */
  readonly entityId: string;
}

/** One resolved container, before its title is loaded. */
interface ContainerRef {
  readonly kind: ContainerKind;
  readonly id: string;
}

function containerKey(ref: ContainerRef): string {
  return `${ref.kind}:${ref.id}`;
}

/**
 * Resolve the work containers referencing each target, in one batch.
 *
 * @remarks
 * Absence is a real answer. A target with no visible work context maps to an empty array, which the
 * Library renders as "Unreferenced".
 *
 * Two visibility passes are necessary. A reference is dropped unless its host subject is visible.
 * A container is then dropped unless it is visible because a public task can sit inside a private
 * project. Naming that project would leak it.
 *
 * @param organizationId - The workspace to resolve within; references never cross it.
 * @param targets - The page's rows.
 * @param visible - The caller's visibility gate; see {@link VisibleEntityLookup}.
 * @returns A map from `documentId` to its containers, most-referencing first.
 */
export async function resolveUsedIn(
  organizationId: string,
  targets: readonly UsedInTarget[],
  visible: VisibleEntityLookup,
): Promise<ReadonlyMap<string, readonly SearchUsedIn[]>> {
  const empty = new Map<string, readonly SearchUsedIn[]>();
  if (targets.length === 0) return empty;
  const schema = await import('@docket/db');

  const externalIds = targets
    .filter((target) => target.kind === 'external_resource')
    .map((target) => target.entityId);
  const attachmentIds = targets
    .filter((target) => target.kind === 'attachment')
    .map((target) => target.entityId);
  const entityTargets = targets.filter(
    (target) => target.kind !== 'external_resource' && target.kind !== 'attachment',
  );

  // The two arms of `mention`: a reference points either at an external resource or at a Docket
  // entity, never both, and each arm has its own index.
  const arms = [];
  if (externalIds.length > 0) {
    arms.push(inArray(schema.mention.externalResourceId, externalIds));
  }
  if (entityTargets.length > 0) {
    arms.push(
      inArray(
        schema.mention.targetEntityId,
        entityTargets.map((t) => t.entityId),
      ),
    );
  }
  const [mentions, attachments] = await Promise.all([
    arms.length > 0
      ? schema.db
          .select({
            subjectType: schema.mention.subjectType,
            subjectId: schema.mention.subjectId,
            targetEntityKind: schema.mention.targetEntityKind,
            targetEntityId: schema.mention.targetEntityId,
            externalResourceId: schema.mention.externalResourceId,
          })
          .from(schema.mention)
          .where(and(eq(schema.mention.organizationId, organizationId), or(...arms)))
      : Promise.resolve([]),
    attachmentIds.length > 0 || externalIds.length > 0
      ? schema.db
          .select({
            id: schema.attachment.id,
            subjectType: schema.attachment.subjectType,
            subjectId: schema.attachment.subjectId,
            externalResourceId: schema.attachment.externalResourceId,
          })
          .from(schema.attachment)
          .where(
            and(
              eq(schema.attachment.organizationId, organizationId),
              or(
                ...(attachmentIds.length > 0 ? [inArray(schema.attachment.id, attachmentIds)] : []),
                ...(externalIds.length > 0
                  ? [inArray(schema.attachment.externalResourceId, externalIds)]
                  : []),
              ),
            ),
          )
      : Promise.resolve([]),
  ]);

  const references: {
    subjectType: string;
    subjectId: string;
    entityId: string;
    targetKind: SearchDocumentKind | null;
  }[] = [];
  for (const mention of mentions) {
    const entityId = mention.externalResourceId ?? mention.targetEntityId;
    if (!entityId) continue;
    references.push({
      subjectType: mention.subjectType,
      subjectId: mention.subjectId,
      entityId,
      targetKind: mention.externalResourceId
        ? 'external_resource'
        : (mention.targetEntityKind as SearchDocumentKind | null),
    });
  }
  for (const attachment of attachments) {
    references.push({
      subjectType: attachment.subjectType,
      subjectId: attachment.subjectId,
      entityId: attachment.id,
      targetKind: 'attachment',
    });
    if (attachment.externalResourceId) {
      references.push({
        subjectType: attachment.subjectType,
        subjectId: attachment.subjectId,
        entityId: attachment.externalResourceId,
        targetKind: 'external_resource',
      });
    }
  }
  if (references.length === 0) return empty;

  const visibleSubjects = await visible(organizationId, [
    ...new Set(references.map((reference) => reference.subjectId)),
  ]);
  const readableReferences = references.filter((reference) =>
    visibleSubjects.has(reference.subjectId),
  );
  if (readableReferences.length === 0) return empty;

  const { containers: containersBySubject, knownTitles } = await resolveSubjectContainers(
    organizationId,
    readableReferences,
  );

  const candidateRefs = [...containersBySubject.values()].flat();
  // Keep every hierarchy candidate until this point. Choosing an initiative before the visibility
  // pass can discard a visible sibling or prevent a fallback to a visible project.
  const visibleContainers = await visible(organizationId, [
    ...new Set(candidateRefs.map((ref) => ref.id)),
  ]);

  // Count containers per target so the most-referencing one leads the row.
  const counts = new Map<string, Map<string, { ref: ContainerRef; count: number }>>();
  const targetByEntity = new Map<string, UsedInTarget[]>();
  for (const target of targets) {
    const list = targetByEntity.get(target.entityId) ?? [];
    list.push(target);
    targetByEntity.set(target.entityId, list);
  }

  for (const reference of readableReferences) {
    const candidates = (
      containersBySubject.get(`${reference.subjectType}:${reference.subjectId}`) ?? []
    ).filter((candidate) => visibleContainers.has(candidate.id));
    if (candidates.length === 0) continue;
    const highestAltitude = Math.min(
      ...candidates.map((candidate) => CONTAINER_ALTITUDE[candidate.kind]),
    );
    const containers = candidates.filter(
      (candidate) => CONTAINER_ALTITUDE[candidate.kind] === highestAltitude,
    );
    for (const target of targetByEntity.get(reference.entityId) ?? []) {
      // Entity ids share one text space, so a same-valued attachment and work id must not inherit
      // each other's context. Older entity mentions can lack a kind and keep their legacy match.
      if (reference.targetKind !== null && reference.targetKind !== target.kind) continue;
      let perTarget = counts.get(target.documentId);
      if (!perTarget) {
        perTarget = new Map();
        counts.set(target.documentId, perTarget);
      }
      for (const container of containers) {
        const key = containerKey(container);
        const existing = perTarget.get(key);
        if (existing) existing.count += 1;
        else perTarget.set(key, { ref: container, count: 1 });
      }
    }
  }

  const containerRefs = [...counts.values()].flatMap((perTarget) =>
    [...perTarget.values()].map((entry) => entry.ref),
  );
  const titles = await loadContainerTitles(organizationId, containerRefs, knownTitles);

  const resolved = new Map<string, readonly SearchUsedIn[]>();
  for (const [documentId, perTarget] of counts) {
    // Keep every visible context. Library duplicates a resource into each work-context group, so
    // truncating here would make the resource undiscoverable from later groups.
    const ordered = [...perTarget.values()]
      .sort(
        (a, b) =>
          b.count - a.count ||
          CONTAINER_ALTITUDE[a.ref.kind] - CONTAINER_ALTITUDE[b.ref.kind] ||
          a.ref.id.localeCompare(b.ref.id),
      )
      .flatMap((entry) => {
        const title = titles.get(containerKey(entry.ref));
        // A container whose title did not resolve is dropped rather than rendered as its id: a raw
        // ULID in this column is noise, and the row still reads correctly without it.
        return title ? [{ kind: entry.ref.kind, id: entry.ref.id, title }] : [];
      });
    if (ordered.length > 0) resolved.set(documentId, ordered);
  }
  return resolved;
}

/**
 * Map each referencing subject to every hierarchy container it can roll up to.
 *
 * @remarks
 * The roll-up is the whole point of the column. A resource linked from eleven tasks across three
 * projects of one launch should read "Q3 launch" once, not name three projects or eleven tasks.
 * This function preserves every altitude and sibling initiative because visibility filtering must
 * happen before the caller chooses the highest visible level.
 *
 * Initiatives are *not* reachable through `ancestorPath`: they relate to projects and programs
 * through the `initiative_project` and `initiative_program` join tables, on a separate axis from
 * the org → program → project containment chain. That is why this walks explicitly rather than
 * reading a materialized path.
 *
 * Four batched queries at most, regardless of page size. A subject that is neither a container nor
 * a task — a comment, an update — contributes nothing rather than something misleading.
 */
async function resolveSubjectContainers(
  organizationId: string,
  mentions: readonly { subjectType: string; subjectId: string }[],
): Promise<{
  containers: ReadonlyMap<string, readonly ContainerRef[]>;
  /** Titles already read while walking, so the title load need not re-select them. */
  knownTitles: ReadonlyMap<string, string>;
}> {
  const schema = await import('@docket/db');
  // The containers each subject sits in before any roll-up.
  const direct = new Map<string, ContainerRef[]>();
  const taskIds = new Set<string>();
  const knownTitles = new Map<string, string>();

  for (const mention of mentions) {
    const key = `${mention.subjectType}:${mention.subjectId}`;
    if (direct.has(key) || taskIds.has(mention.subjectId)) continue;
    switch (mention.subjectType) {
      case 'initiative':
      case 'program':
      case 'project':
      case 'team':
        direct.set(key, [{ kind: mention.subjectType, id: mention.subjectId }]);
        break;
      case 'task':
        taskIds.add(mention.subjectId);
        break;
      default:
        break;
    }
  }

  if (taskIds.size > 0) {
    const rows = await schema.db
      .select({
        id: schema.task.id,
        projectId: schema.task.projectId,
        programId: schema.task.programId,
        teamId: schema.task.teamId,
      })
      .from(schema.task)
      .where(
        and(eq(schema.task.organizationId, organizationId), inArray(schema.task.id, [...taskIds])),
      );
    for (const row of rows) {
      const refs: ContainerRef[] = [];
      if (row.projectId) refs.push({ kind: 'project', id: row.projectId });
      if (row.programId) refs.push({ kind: 'program', id: row.programId });
      if (row.teamId) refs.push({ kind: 'team', id: row.teamId });
      if (refs.length > 0) direct.set(`task:${row.id}`, refs);
    }
  }

  const projectIds = new Set<string>();
  const programIds = new Set<string>();
  for (const ref of [...direct.values()].flat()) {
    if (ref.kind === 'project') projectIds.add(ref.id);
    if (ref.kind === 'program') programIds.add(ref.id);
  }

  // A project's own program (so a project-level reference can roll up past it) and the initiatives
  // containing those projects. Both depend only on `projectIds`, so they run together rather than
  // one after the other — the program lookup also feeds `programIds`, which is why the *next*
  // query has to wait for this pair and cannot join them.
  //
  // The project select carries `name` so `loadContainerTitles` need not read the same rows again.
  const [projectRows, projectInitiativeRows] = await Promise.all([
    projectIds.size > 0
      ? schema.db
          .select({
            id: schema.project.id,
            name: schema.project.name,
            programId: schema.project.programId,
          })
          .from(schema.project)
          .where(
            and(
              eq(schema.project.organizationId, organizationId),
              inArray(schema.project.id, [...projectIds]),
            ),
          )
      : Promise.resolve([]),
    projectIds.size > 0
      ? schema.db
          .select({
            initiativeId: schema.initiativeProject.initiativeId,
            projectId: schema.initiativeProject.projectId,
          })
          .from(schema.initiativeProject)
          .where(
            and(
              eq(schema.initiativeProject.organizationId, organizationId),
              inArray(schema.initiativeProject.projectId, [...projectIds]),
            ),
          )
      : Promise.resolve([]),
  ]);

  const projectProgram = new Map<string, string>();
  for (const row of projectRows) {
    knownTitles.set(`project:${row.id}`, row.name);
    if (row.programId) {
      projectProgram.set(row.id, row.programId);
      programIds.add(row.programId);
    }
  }

  const projectInitiative = new Map<string, Set<string>>();
  for (const row of projectInitiativeRows) {
    const ids = projectInitiative.get(row.projectId) ?? new Set<string>();
    ids.add(row.initiativeId);
    projectInitiative.set(row.projectId, ids);
  }

  const programInitiative = new Map<string, Set<string>>();
  if (programIds.size > 0) {
    const rows = await schema.db
      .select({
        initiativeId: schema.initiativeProgram.initiativeId,
        programId: schema.initiativeProgram.programId,
      })
      .from(schema.initiativeProgram)
      .where(
        and(
          eq(schema.initiativeProgram.organizationId, organizationId),
          inArray(schema.initiativeProgram.programId, [...programIds]),
        ),
      );
    for (const row of rows) {
      const ids = programInitiative.get(row.programId) ?? new Set<string>();
      ids.add(row.initiativeId);
      programInitiative.set(row.programId, ids);
    }
  }

  const resolved = new Map<string, readonly ContainerRef[]>();
  for (const [key, refs] of direct) {
    const candidates = new Map<string, ContainerRef>();
    const add = (ref: ContainerRef): void => {
      candidates.set(containerKey(ref), ref);
    };
    for (const ref of refs) {
      add(ref);
      if (ref.kind === 'project') {
        for (const initiativeId of projectInitiative.get(ref.id) ?? []) {
          add({ kind: 'initiative', id: initiativeId });
        }
        const programId = projectProgram.get(ref.id);
        if (programId) {
          add({ kind: 'program', id: programId });
          for (const initiativeId of programInitiative.get(programId) ?? []) {
            add({ kind: 'initiative', id: initiativeId });
          }
        }
      }
      if (ref.kind === 'program') {
        for (const initiativeId of programInitiative.get(ref.id) ?? []) {
          add({ kind: 'initiative', id: initiativeId });
        }
      }
    }
    resolved.set(key, [...candidates.values()]);
  }
  return { containers: resolved, knownTitles };
}

/**
 * Load display titles for the resolved containers, one query per kind.
 *
 * @remarks
 * Separate `IN` lookups rather than a union, because the four tables name their title column
 * differently and a union would need casting each one anyway. They share no state, so they run
 * concurrently — one round of latency instead of four.
 *
 * @param organizationId - The workspace the containers belong to.
 * @param refs - Every container that needs a title.
 * @param known - Titles the caller already read while walking containment; these are not re-queried.
 */
async function loadContainerTitles(
  organizationId: string,
  refs: readonly ContainerRef[],
  known: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, string>> {
  // Seeded titles are keyed the same way, but only for refs that survived the visibility filter —
  // seeding the whole map would reintroduce the names this call exists to withhold.
  const allowed = new Set(refs.map(containerKey));
  const titles = new Map<string, string>([...known].filter(([key]) => allowed.has(key)));
  if (refs.length === 0) return titles;
  const schema = await import('@docket/db');

  const idsByKind = new Map<ContainerKind, Set<string>>();
  for (const ref of refs) {
    if (titles.has(containerKey(ref))) continue;
    const set = idsByKind.get(ref.kind) ?? new Set<string>();
    set.add(ref.id);
    idsByKind.set(ref.kind, set);
  }
  if (idsByKind.size === 0) return titles;

  const tables = {
    initiative: schema.initiative,
    program: schema.program,
    project: schema.project,
    team: schema.team,
  } as const;

  const loaded = await Promise.all(
    [...idsByKind].map(async ([kind, ids]) => {
      const table = tables[kind];
      const rows = await schema.db
        .select({ id: table.id, name: table.name })
        .from(table)
        .where(and(eq(table.organizationId, organizationId), inArray(table.id, [...ids])));
      return rows.map((row) => [`${kind}:${row.id}`, row.name] as const);
    }),
  );
  for (const [key, name] of loaded.flat()) titles.set(key, name);
  return titles;
}
