/**
 * `@docket/api` — resolve which work each resource is actually used by.
 *
 * @remarks
 * The Library's central column. It exists because a reference *count* is a graph statistic, not an
 * answer: knowing a document is linked eighteen times tells you it is popular, while knowing it is
 * linked from the Q3 launch tells you what it is for.
 *
 * The data is already there. `reconcileMentions` writes one `mention` row per reference authored
 * in prose, and `mention_target_entity_idx` plus `mention_resource_idx` make both lookup
 * directions index scans. Nothing here adds a table or a write path.
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
 * Used twice, for two different jobs. {@link rollUp} picks the highest-altitude container a
 * mentioning subject rolls up to, so a document referenced from eleven tasks reads "Q3 launch"
 * rather than naming one arbitrary task's project. The final sort then uses it only as a tiebreak,
 * after reference count.
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

/** Pick the highest-altitude container among the candidates, or `null` when there are none. */
function rollUp(candidates: readonly ContainerRef[]): ContainerRef | null {
  let best: ContainerRef | null = null;
  for (const candidate of candidates) {
    if (!best || CONTAINER_ALTITUDE[candidate.kind] < CONTAINER_ALTITUDE[best.kind]) {
      best = candidate;
    }
  }
  return best;
}

/** How many containers one row reports before collapsing the rest into a `+N` on the client. */
const MAX_CONTAINERS_PER_ROW = 4;

/** A row this module resolves containers for. */
export interface UsedInTarget {
  /** The `search_document.id`, used only to key the result map. */
  readonly documentId: string;
  /** The row's semantic kind, which selects which mention arm to match. */
  readonly kind: SearchDocumentKind;
  /** The source entity id the mention points at. */
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
 * Absence is a real answer: a target with no mentions maps to an empty array, which the Library
 * renders as "Not referenced yet". That state is the point — it surfaces documentation nothing
 * points at, which a count would bury among the ones and twos.
 *
 * @param organizationId - The workspace to resolve within; mentions never cross it.
 * @param targets - The page's rows.
 * @returns A map from `documentId` to its containers, most-referencing first.
 */
export async function resolveUsedIn(
  organizationId: string,
  targets: readonly UsedInTarget[],
): Promise<ReadonlyMap<string, readonly SearchUsedIn[]>> {
  const empty = new Map<string, readonly SearchUsedIn[]>();
  if (targets.length === 0) return empty;
  const schema = await import('@docket/db');

  const externalIds = targets
    .filter((target) => target.kind === 'external_resource')
    .map((target) => target.entityId);
  const entityTargets = targets.filter((target) => target.kind !== 'external_resource');

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
  if (arms.length === 0) return empty;

  const mentions = await schema.db
    .select({
      subjectType: schema.mention.subjectType,
      subjectId: schema.mention.subjectId,
      targetEntityKind: schema.mention.targetEntityKind,
      targetEntityId: schema.mention.targetEntityId,
      externalResourceId: schema.mention.externalResourceId,
    })
    .from(schema.mention)
    .where(and(eq(schema.mention.organizationId, organizationId), or(...arms)));
  if (mentions.length === 0) return empty;

  const { containers: containersBySubject, knownTitles } = await resolveSubjectContainers(
    organizationId,
    mentions,
  );

  // Count containers per target so the most-referencing one leads the row.
  const counts = new Map<string, Map<string, { ref: ContainerRef; count: number }>>();
  const targetByEntity = new Map<string, UsedInTarget[]>();
  for (const target of targets) {
    const list = targetByEntity.get(target.entityId) ?? [];
    list.push(target);
    targetByEntity.set(target.entityId, list);
  }

  for (const mention of mentions) {
    const entityId = mention.externalResourceId ?? mention.targetEntityId;
    if (!entityId) continue;
    const container = containersBySubject.get(`${mention.subjectType}:${mention.subjectId}`);
    if (!container) continue;
    for (const target of targetByEntity.get(entityId) ?? []) {
      // Guard the entity arm: two kinds can share an id space, so match the kind too.
      if (
        target.kind !== 'external_resource' &&
        mention.targetEntityKind !== null &&
        mention.targetEntityKind !== target.kind
      ) {
        continue;
      }
      let perTarget = counts.get(target.documentId);
      if (!perTarget) {
        perTarget = new Map();
        counts.set(target.documentId, perTarget);
      }
      const key = containerKey(container);
      const existing = perTarget.get(key);
      if (existing) existing.count += 1;
      else perTarget.set(key, { ref: container, count: 1 });
    }
  }

  const titles = await loadContainerTitles(
    organizationId,
    [...counts.values()].flatMap((perTarget) => [...perTarget.values()].map((v) => v.ref)),
    knownTitles,
  );

  const resolved = new Map<string, readonly SearchUsedIn[]>();
  for (const [documentId, perTarget] of counts) {
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
      })
      // Trim AFTER dropping title-less containers. Slicing first would let a row whose top few
      // titles failed to load come back empty, and the Library renders that as "Not referenced
      // yet" — the opposite of the truth for a resource that is in fact referenced.
      .slice(0, MAX_CONTAINERS_PER_ROW);
    if (ordered.length > 0) resolved.set(documentId, ordered);
  }
  return resolved;
}

/**
 * Map each mentioning subject to the highest-altitude container it rolls up to.
 *
 * @remarks
 * The roll-up is the whole point of the column. A resource linked from eleven tasks across three
 * projects of one launch should read "Q3 launch" once, not name three projects or eleven tasks.
 * So a task resolves to its project, a project to the initiative that contains it, and a program
 * likewise — and {@link rollUp} then keeps the highest one reached.
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
  containers: ReadonlyMap<string, ContainerRef>;
  /** Titles already read while walking, so the title load need not re-select them. */
  knownTitles: ReadonlyMap<string, string>;
}> {
  const schema = await import('@docket/db');
  // The container each subject sits in before any roll-up.
  const direct = new Map<string, ContainerRef>();
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
        direct.set(key, { kind: mention.subjectType, id: mention.subjectId });
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
      const ref: ContainerRef | null = row.projectId
        ? { kind: 'project', id: row.projectId }
        : row.programId
          ? { kind: 'program', id: row.programId }
          : row.teamId
            ? { kind: 'team', id: row.teamId }
            : null;
      if (ref) direct.set(`task:${row.id}`, ref);
    }
  }

  const projectIds = new Set<string>();
  const programIds = new Set<string>();
  for (const ref of direct.values()) {
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

  // A project or program can belong to several initiatives; keeping the first collapses that to
  // one chip rather than counting the same reference under both. The column answers "what is this
  // for", and two answers to that is worse than the most likely one.
  const projectInitiative = new Map<string, string>();
  for (const row of projectInitiativeRows) {
    if (!projectInitiative.has(row.projectId)) {
      projectInitiative.set(row.projectId, row.initiativeId);
    }
  }

  const programInitiative = new Map<string, string>();
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
      if (!programInitiative.has(row.programId)) {
        programInitiative.set(row.programId, row.initiativeId);
      }
    }
  }

  const resolved = new Map<string, ContainerRef>();
  for (const [key, ref] of direct) {
    const candidates: ContainerRef[] = [ref];
    if (ref.kind === 'project') {
      const initiativeId = projectInitiative.get(ref.id);
      if (initiativeId) candidates.push({ kind: 'initiative', id: initiativeId });
      const programId = projectProgram.get(ref.id);
      if (programId) {
        candidates.push({ kind: 'program', id: programId });
        const viaProgram = programInitiative.get(programId);
        if (viaProgram) candidates.push({ kind: 'initiative', id: viaProgram });
      }
    }
    if (ref.kind === 'program') {
      const initiativeId = programInitiative.get(ref.id);
      if (initiativeId) candidates.push({ kind: 'initiative', id: initiativeId });
    }
    const best = rollUp(candidates);
    if (best) resolved.set(key, best);
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
  const titles = new Map<string, string>(known);
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
