/**
 * `@docket/api` — where a task, project, program, or initiative came from (mounted at
 * `/v1/orgs/:orgId/provenance`).
 *
 * @remarks
 * Reads the change sets recorded against one entity and answers with the change that created it,
 * the most recent change, and how many recorded changes touched it. Each side is normalized through
 * `readOrigin`, so rows written before provenance v2 read the same way new ones do. Access follows
 * the entity's own `GET /:id` route exactly: a caller who cannot open the entity gets the same 404
 * that route returns. See `docs/engineering/specs/provenance.md`.
 */
import { db, program } from '@docket/db';
import {
  PROVENANCE_ENTITY_KINDS,
  ProvenanceOut,
  readOrigin,
  type ProvenanceEntityKind,
  type ProvenanceEventOut,
  type ProvenancePerformer,
} from '@docket/work/provenance-contract';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { one } from '../lib/one';
import { apiDoc } from '../lib/openapi-route';
import { assertProjectInOrg } from '../lib/project-guard';
import { zParam } from '../lib/validate';
import { changeHistoryOf, type ChangeSetStamp } from '../mcp/change-set-history';
import { loadInitiative } from './initiative-helpers';
import { buildTaskViewFilter, loadTask } from './task-helpers';

/** Path parameters: the entity kind and its id. */
const ProvenanceParam = z.object({
  kind: z
    .enum(PROVENANCE_ENTITY_KINDS)
    .describe('The kind of entity: `task`, `project`, `initiative`, or `program`.'),
  id: z.string().describe('The entity id.'),
});

/** One provenance event as the handler builds it, before response validation. */
type ProvenanceEventBody = z.input<typeof ProvenanceEventOut>;

/** The provenance answer as the handler builds it, before response validation. */
type ProvenanceBody = z.input<typeof ProvenanceOut>;

/** Resolves when the caller may read the entity; throws {@link NotFoundError} otherwise. */
type SubjectReadGuard = (orgId: string, actorId: string, id: string) => Promise<void>;

/** A task is readable when it is active in the org and passes the caller's task visibility. */
async function assertTaskReadable(orgId: string, actorId: string, id: string): Promise<void> {
  const row = await loadTask(orgId, id);
  const canView = await buildTaskViewFilter(orgId, actorId);
  if (!canView(row)) throw new NotFoundError('Task not found');
}

/** A program is readable when it exists in the org, as on `GET /programs/:id`. */
async function assertProgramInOrg(orgId: string, _actorId: string, id: string): Promise<void> {
  const row = await one(
    db
      .select({ id: program.id })
      .from(program)
      .where(and(eq(program.id, id), eq(program.organizationId, orgId))),
  );
  if (!row) throw new NotFoundError('Program not found');
}

/** The read check each entity kind's own `GET /:id` route applies. */
const READ_GUARDS: Readonly<Record<ProvenanceEntityKind, SubjectReadGuard>> = {
  task: assertTaskReadable,
  project: (orgId, _actorId, id) => assertProjectInOrg(orgId, id),
  initiative: async (orgId, _actorId, id) => {
    await loadInitiative(orgId, id);
  },
  program: assertProgramInOrg,
};

/**
 * The display name of a change's performer.
 *
 * @param performer - The normalized performer.
 * @returns null for a person, who is named as the authority; otherwise the performer's name.
 */
function performerNameOf(performer: ProvenancePerformer): string | null {
  if (performer.kind === 'person') return null;
  return performer.name ?? null;
}

/**
 * Project one recorded change set onto the public provenance event.
 *
 * @param stamp - The change set.
 * @returns the event, or null when its origin predates provenance and cannot be placed.
 */
export function toProvenanceEvent(stamp: ChangeSetStamp | null): ProvenanceEventBody | null {
  const provenance = stamp ? readOrigin(stamp.origin) : null;
  if (!stamp || !provenance) return null;
  return {
    at: stamp.at.toISOString(),
    channel: provenance.channel,
    surface: provenance.surface,
    performerKind: provenance.performer.kind,
    performerName: performerNameOf(provenance.performer),
    authorityActorId: stamp.actorId,
    authorityName: stamp.actorName,
    clientName: provenance.client?.name ?? null,
    provider: provenance.integration?.provider ?? null,
    sessionId: provenance.sessionId,
    planId: provenance.planId,
  };
}

/**
 * Read where one entity came from.
 *
 * @param orgId - The organization the entity belongs to.
 * @param kind - The entity kind.
 * @param id - The entity id.
 * @returns the created and last-changed events and the change count.
 */
export async function loadProvenance(
  orgId: string,
  kind: ProvenanceEntityKind,
  id: string,
): Promise<ProvenanceBody> {
  const history = await changeHistoryOf(orgId, kind, id);
  const latest = history.latest?.id === history.created?.id ? null : history.latest;
  return {
    created: toProvenanceEvent(history.created),
    lastChanged: toProvenanceEvent(latest),
    changeCount: history.count,
  };
}

/** Provenance router: one read per entity. */
const provenance = new Hono<AppEnv>().get(
  '/:kind/:id',
  apiDoc({
    tag: 'Activity',
    summary: 'Get where a work item came from',
    response: ProvenanceOut,
    description:
      'Return the change that created a task, project, initiative, or program, the most recent change to it, and how many recorded changes touched it. Each change names the member whose permissions it ran under, who performed it (a person, Docket’s assistant, a third-party AI client, or Docket itself), and the channel it arrived through, with the client, connected tool, session, or plan when there is one. Changes that were undone are not counted and never appear as the most recent change. `created` is null for an item that predates provenance recording, and `lastChanged` is null when nothing has changed since creation. Requires read access to the item; an item the caller cannot open returns 404.',
  }),
  zParam(ProvenanceParam),
  async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const { kind, id } = c.req.valid('param');
    await READ_GUARDS[kind](orgId, actorId, id);
    return ok(c, ProvenanceOut, await loadProvenance(orgId, kind, id));
  },
);

export default provenance;
