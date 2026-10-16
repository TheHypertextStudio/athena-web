import { actor, milestone } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ActorCtx } from '../../context';
import { ConflictError, NotFoundError } from '../../error';
import type { Tx, UndoAccessCheck } from '../../mcp/change-set';
import type { StoredEntry } from '../../mcp/change-set-companions';
import { loadCreationActor } from '../work-creation/context';
import { requireWorkAccess } from '../work-template-selection';
import { requireScheduleAccess } from './schedule-access';

const protectedKinds = new Set([
  'program_default_schedule',
  'native_schedule_date_ownership',
  'retained_date_ownership',
]);
const workKind = z.enum(['task', 'project', 'program', 'initiative', 'milestone']);
const dateReference = z.object({
  workKind: z.enum(['task', 'project', 'milestone']),
  workId: z.string().min(1),
});
const subjectKinds: Readonly<Record<string, string>> = {
  task_labels: 'task',
  project_labels: 'project',
  program_labels: 'program',
  initiative_labels: 'initiative',
  initiative_parent: 'initiative',
};
interface WorkReference {
  readonly kind: z.infer<typeof workKind>;
  readonly id: string;
}
type UndoCaller =
  Pick<ActorCtx, 'orgId' | 'actorId'> | { readonly orgId: string; readonly userId: string };

async function liveCaller(tx: Tx, caller: UndoCaller): Promise<ActorCtx> {
  if ('actorId' in caller) return loadCreationActor(tx, caller.orgId, caller.actorId);
  const [member] = await tx
    .select({ id: actor.id })
    .from(actor)
    .where(and(eq(actor.organizationId, caller.orgId), eq(actor.userId, caller.userId)))
    .limit(1);
  if (!member) throw new NotFoundError('Workspace not found');
  return loadCreationActor(tx, caller.orgId, member.id);
}
function workReferences(entries: readonly StoredEntry[]): WorkReference[] {
  const refs = new Map<string, WorkReference>();
  for (const entry of entries) {
    const ordinary = workKind.safeParse(subjectKinds[entry.entityKind] ?? entry.entityKind);
    if (ordinary.success)
      refs.set(`${ordinary.data}:${entry.entityId}`, { kind: ordinary.data, id: entry.entityId });
    if (!['native_schedule_date_ownership', 'retained_date_ownership'].includes(entry.entityKind))
      continue;
    const stored = dateReference.safeParse(entry.after);
    if (!stored.success) throw new ConflictError('Change can no longer be undone');
    const ref = { kind: stored.data.workKind, id: stored.data.workId };
    refs.set(`${ref.kind}:${ref.id}`, ref);
  }
  return [...refs.values()].sort((left, right) =>
    `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
  );
}
async function requireUndoWork(tx: Tx, caller: ActorCtx, reference: WorkReference): Promise<void> {
  if (reference.kind !== 'milestone')
    return requireWorkAccess(tx, caller, reference.kind, reference.id);
  const [current] = await tx
    .select({ projectId: milestone.projectId })
    .from(milestone)
    .where(and(eq(milestone.organizationId, caller.orgId), eq(milestone.id, reference.id)))
    .limit(1);
  if (!current) throw new NotFoundError('Work not found');
  await requireWorkAccess(tx, caller, 'project', current.projectId);
}

/**
 * Recheck current work and schedule rights before a protected receipt performs any atomic undo writes.
 * @param caller - The authenticated request actor or signed-in user; stored receipt attribution grants no rights.
 * @returns A transaction-local guard; ordinary receipts retain their existing undo policy.
 * @throws When membership, affected work editing or an installed routine's management rights were revoked.
 */
export function workScheduleUndoAccess(caller: UndoCaller): UndoAccessCheck {
  const check: UndoAccessCheck = async (tx, entries) => {
    if (!entries.some((entry) => protectedKinds.has(entry.entityKind))) return;
    const current = await liveCaller(tx, caller);
    const schedules = [
      ...new Set(
        entries
          .filter((entry) => entry.entityKind === 'program_default_schedule')
          .map((entry) => entry.entityId),
      ),
    ].sort();
    for (const seriesId of schedules)
      await requireScheduleAccess(
        tx,
        { organizationId: current.orgId, actorId: current.actorId, seriesId },
        'manage',
      );
    for (const reference of workReferences(entries)) await requireUndoWork(tx, current, reference);
  };
  return Object.assign(check, { templateCopyCaller: caller });
}
