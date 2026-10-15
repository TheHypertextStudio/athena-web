import { actor, role } from '@docket/db';
import { satisfies } from '@docket/authz';
import { and, eq, isNull } from 'drizzle-orm';
import type { ActorCtx } from '../../context';
import { CapabilityError, NotFoundError } from '../../error';
import {
  resourceAccessKey,
  resolveResourceAccessForActors,
  type ResourceAccessRef,
} from '../../permissions/resource-access';
import { assertSharedWorkWritable } from '../../product-capability';
import type { TemplateTransaction } from '../templates/persistence';
import {
  requireRetainedOccurrenceAuthority,
  type AuthorizedRetainedOccurrence,
} from '../work-creation/retained-authority';
import type { BlueprintSnapshotAuthority, BlueprintSnapshotRow } from './snapshot-types';

/** Verified live caller and optional exact persisted occurrence, never an unregistered nullable actor. */
export interface BlueprintSnapshotCaller {
  readonly orgId: string;
  readonly actor: ActorCtx | null;
  readonly retained: AuthorizedRetainedOccurrence | null;
}
/** Resolve only foreground authority or an exact transaction-bound retained capability. */
export function snapshotCaller(
  tx: TemplateTransaction,
  authority: BlueprintSnapshotAuthority,
): BlueprintSnapshotCaller {
  if ('kind' in authority) {
    const retained = requireRetainedOccurrenceAuthority(tx, authority);
    return {
      orgId: retained.organizationId,
      actor: retained.caller.actorId === null ? null : retained.caller,
      retained,
    };
  }
  return { orgId: authority.orgId, actor: authority, retained: null };
}
function assertRetainedRows(
  caller: BlueprintSnapshotCaller,
  rows: readonly BlueprintSnapshotRow[],
): void {
  const facts = caller.retained;
  if (!facts) throw new CapabilityError();
  const accept = retainedSnapshotFilter(caller);
  for (const row of rows) if (!accept(row)) throw new NotFoundError('Work not found');
}
/** Check every required row before returning prose; Milestones inherit their actual Project's authority. */
export async function authorizeBlueprintRows(
  tx: TemplateTransaction,
  caller: BlueprintSnapshotCaller,
  rows: readonly BlueprintSnapshotRow[],
  write: boolean,
): Promise<void> {
  if (!caller.actor) {
    assertRetainedRows(caller, rows);
    if (write) await assertSharedWorkWritable(caller.orgId, undefined, tx);
    return;
  }
  const [live] = await tx
    .select({ actor, role })
    .from(actor)
    .leftJoin(role, and(eq(role.id, actor.roleId), eq(role.organizationId, caller.orgId)))
    .where(
      and(
        eq(actor.organizationId, caller.orgId),
        eq(actor.id, caller.actor.actorId),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!live) throw new NotFoundError('Work not found');
  const refs: ResourceAccessRef[] = rows.map(({ work }) => ({
    organizationId: caller.orgId,
    kind: work.kind === 'milestone' ? 'project' : work.kind,
    id: work.kind === 'milestone' ? work.row.projectId : work.id,
  }));
  const access = await resolveResourceAccessForActors(
    [
      {
        organizationId: caller.orgId,
        actorId: live.actor.id,
        roleId: live.actor.roleId,
        isGuest: live.role?.key === 'guest' || live.role?.defaultVisibility === 'private',
      },
    ],
    refs,
    tx,
  );
  assertAccessResults(refs, access, write);
  if (write) await assertSharedWorkWritable(caller.orgId, caller.actor.isPersonal, tx);
}

function assertAccessResults(
  refs: readonly ResourceAccessRef[],
  access: Awaited<ReturnType<typeof resolveResourceAccessForActors>>,
  write: boolean,
): void {
  for (const ref of refs) {
    const result = access.get(resourceAccessKey(ref));
    if (!result?.canView) throw new NotFoundError('Work not found');
    if (
      write &&
      (!result.effectiveCapability ||
        !satisfies(result.effectiveCapability, ref.kind === 'program' ? 'manage' : 'contribute'))
    )
      throw new CapabilityError();
  }
}

/** Restrict nullable retained execution to exact invocation work and its checked generated origins. */
export function retainedSnapshotFilter(
  caller: BlueprintSnapshotCaller,
): (entry: BlueprintSnapshotRow) => boolean {
  const facts = caller.retained;
  if (!facts) throw new CapabilityError();
  const mapped = new Set([...facts.mappedWork.values()].map((work) => `${work.kind}:${work.id}`));
  const included = new Set<string>();
  const selected = new Set(
    facts.rootRefs.flatMap((root) =>
      (root.selectedWork ?? []).map((work) => `${work.kind}:${work.id}`),
    ),
  );
  return ({ work, parent }) => {
    const key = `${work.kind}:${work.id}`;
    const generated = selected.has(key) && isRetainedGenerated({ work, parent }, included);
    if (!mapped.has(key) && !generated) return false;
    included.add(key);
    return true;
  };
}

function isRetainedGenerated(
  { work, parent }: BlueprintSnapshotRow,
  included: ReadonlySet<string>,
): boolean {
  return Boolean(
    parent &&
    included.has(`${parent.kind}:${parent.id}`) &&
    work.row.blueprintStepId !== null &&
    work.row.blueprintSourceVersionId !== null &&
    work.row.blueprintParentKind === parent.kind &&
    work.row.blueprintParentId === parent.id,
  );
}
