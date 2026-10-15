import { recordToolActivity } from '../../mcp/tool-activity';
import { emitEvent } from '../../routes/event-emit';
import { enqueueSearchUpsert } from '../../search/write-through';
import { deferAfterResponse } from '../after-response';
import { finishTaskStateTransition } from '../task-state';
import type { DeferredWorkEffect } from './types';

/** Drain typed effects only after their enclosing transaction committed; failures cannot reject creation. */
export function deferWorkCreationEffects(effects: readonly DeferredWorkEffect[]): void {
  const transitionedTaskIds = new Set(
    effects.flatMap((effect) => (effect.kind === 'task-state' ? [effect.mutation.after.id] : [])),
  );
  const seen = new Set<string>();
  for (const effect of effects) {
    if (seen.has(effect.dedupeKey)) continue;
    seen.add(effect.dedupeKey);
    deferAfterResponse(`work-created-${effect.kind}`, () =>
      runWorkCreationEffect(effect, transitionedTaskIds),
    );
  }
}

async function runWorkCreationEffect(
  effect: DeferredWorkEffect,
  transitionedTaskIds: ReadonlySet<string>,
): Promise<void> {
  if (effect.kind === 'refresh-subject') {
    await enqueueSearchUpsert(effect.orgId, effect.subjectKind, effect.subjectId);
    return;
  }
  if (effect.kind === 'tool-activity') {
    await recordToolActivity(
      effect.orgId,
      effect.actorId,
      effect.changes.filter(
        (change) =>
          change.kind !== 'task' || !('id' in change) || !transitionedTaskIds.has(change.id),
      ),
    );
    return;
  }
  if (effect.kind === 'task-state') {
    await finishTaskStateTransition({ actorId: null }, effect.mutation);
    return;
  }
  const work = effect.work;
  if (effect.kind === 'search') {
    await enqueueSearchUpsert(work.row.organizationId, work.kind, work.id);
    return;
  }
  const title = work.kind === 'task' ? work.row.title : work.row.name;
  const event = {
    organizationId: work.row.organizationId,
    actorId: effect.actorId,
    occurredAt: work.row.createdAt,
    title,
    subject: { type: work.kind, id: work.id, title },
  };
  await emitEvent({ ...event, kind: 'created' });
  if (work.kind === 'task' && work.row.assigneeId)
    await emitEvent({ ...event, kind: 'assignment' });
}
