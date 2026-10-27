/** Bind email model calls to the source actor's person and the receiving workspace. */
import type { TaskDraft, TaskDraftInput, TaskSynthesizer } from '@docket/work/task-drafting';
import { actor, db } from '@docket/db';
import { eq } from 'drizzle-orm';
import { withAiUsage } from './direct-calls';

/** Resolve a human actor when present; autonomous workspace work has no invented person. */
export async function synthesizeEmailTask(
  synthesizer: TaskSynthesizer,
  owner: { actorId: string | null; organizationId: string },
  input: TaskDraftInput,
): Promise<TaskDraft> {
  const [person] =
    owner.actorId === null
      ? []
      : await db.select({ userId: actor.userId }).from(actor).where(eq(actor.id, owner.actorId));
  return withAiUsage(
    {
      source: 'email_synthesis',
      userId: person?.userId ?? null,
      organizationId: owner.organizationId,
    },
    () => synthesizer.synthesize(input),
  );
}
