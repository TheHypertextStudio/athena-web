/**
 * `@docket/api` — resolving the descriptor and relation fields of an `update` patch.
 *
 * @remarks
 * Everything here is the same for every row a call touches, so it resolves once before the row
 * loop in `update-tool.ts`. A bad name or an initiative the caller may not contribute to fails the
 * call before a single row is written.
 */
import type { z } from 'zod';

import { resolveOptional } from './descriptors';
import type { McpActor } from './auth';
import { authorize } from './result';
import type { updateSetFields } from './update-tool-contract';
import {
  initiativesNamed,
  resolveCycleTarget,
  resolveInitiativeEdit,
  type CycleTarget,
  type InitiativeEdit,
} from './update-relations';

/** The patch a caller supplied, before resolution. */
type UpdateSet = z.infer<z.ZodObject<typeof updateSetFields>>;

/**
 * The descriptor-valued fields of a patch, resolved to ids.
 *
 * @remarks
 * Each is `undefined` when the caller did not mention the field, and `null` when they asked to
 * clear it — the same three-state distinction the wire schema makes.
 */
export interface ResolvedRefs {
  readonly assignee: string | null | undefined;
  readonly delegate: string | null | undefined;
  readonly lead: string | null | undefined;
  readonly owner: string | null | undefined;
  readonly projectId: string | null | undefined;
  readonly programId: string | null | undefined;
  readonly teamId: string | null | undefined;
  readonly cycleId: string | null | undefined;
}

/**
 * Resolve the descriptor-valued fields of a patch once, for every row.
 *
 * @remarks
 * These are the same for every target, so they resolve before the loop rather than per row —
 * a 100-row reassignment would otherwise pay 100 identical lookups for one name.
 *
 * @param orgId - The organization being updated within.
 * @param set - The caller's patch.
 * @returns the resolved ids.
 */
export async function resolveReferences(
  orgId: string,
  set: UpdateSet,
  cycle: CycleTarget | undefined,
): Promise<ResolvedRefs> {
  const [assignee, delegate, lead, owner, projectId, programId, teamId] = await Promise.all([
    resolveOptional(orgId, 'actor', set.assignee, 'set.assignee'),
    resolveOptional(orgId, 'actor', set.delegate, 'set.delegate'),
    resolveOptional(orgId, 'actor', set.lead, 'set.lead'),
    resolveOptional(orgId, 'actor', set.owner, 'set.owner'),
    resolveOptional(orgId, 'project', set.project, 'set.project'),
    resolveOptional(orgId, 'program', set.program, 'set.program'),
    resolveOptional(orgId, 'team', set.team, 'set.team'),
  ]);
  const cycleId = cycle?.cycleId;
  return { assignee, delegate, lead, owner, projectId, programId, teamId, cycleId };
}

/**
 * Resolve the relation fields of a patch once, authorizing every initiative it names.
 *
 * @remarks
 * Joining or leaving an initiative changes that initiative's roll-up as much as the item's, so the
 * caller needs `contribute` on each initiative named, exactly as `link contributes_to` asks.
 */
export async function resolveRelations(
  actorCtx: McpActor,
  orgId: string,
  set: UpdateSet,
): Promise<{ cycle: CycleTarget | undefined; initiatives: InitiativeEdit | undefined }> {
  const [cycle, initiatives] = await Promise.all([
    resolveCycleTarget(orgId, set.cycle),
    resolveInitiativeEdit(orgId, set.initiatives),
  ]);
  for (const id of initiatives ? initiativesNamed(initiatives) : []) {
    await authorize(actorCtx, 'contribute', { kind: 'initiative', id, orgId });
  }
  return { cycle, initiatives };
}

/** The reference columns a patch writes, from the already-resolved descriptor ids. */
export function referencePatch(refs: ResolvedRefs): Record<string, string | null> {
  const columns: [string, string | null | undefined][] = [
    ['assigneeId', refs.assignee],
    ['delegateId', refs.delegate],
    ['leadId', refs.lead],
    ['ownerId', refs.owner],
    ['projectId', refs.projectId],
    ['programId', refs.programId],
    ['teamId', refs.teamId],
    ['cycleId', refs.cycleId],
  ];
  return Object.fromEntries(
    columns.filter((entry): entry is [string, string | null] => entry[1] !== undefined),
  );
}
