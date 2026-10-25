import { legacyScheduleTasksComplete } from '@docket/work/schedule-legacy-completion';
import type { ScheduleTimingMapping } from '@docket/work/schedule-field-timing';
import type { TemplateTransaction } from '../templates/persistence';
import type { NativeScheduleFacts } from './schedule-native-facts';
import type { NativeScheduleStatus } from './schedule-native-status';
import { loadNativeScheduleCompletionFacts } from './schedule-native-completion-facts';

/** Evaluate only actual authored Task timestamps; Project state and template-only descendants are independent. */
export async function readNativeLegacyScheduleStatus(
  tx: TemplateTransaction,
  facts: NativeScheduleFacts,
): Promise<NativeScheduleStatus | null> {
  const document = facts.document;
  if (
    document.kind !== 'forest' ||
    document.revision !== 2 ||
    document.completionPolicy.kind !== 'legacy_authored_tasks'
  )
    return null;
  const policy = document.completionPolicy;
  const mappings: ScheduleTimingMapping[] = policy.tasks.flatMap((reference) => {
    const root = facts.roots.find((entry) => entry.key === reference.rootKey);
    const work = reference.path.length
      ? root?.selectedWork?.find(
          (entry) => JSON.stringify(entry.path) === JSON.stringify(reference.path),
        )
      : root;
    return work && (work.kind === 'task' || work.kind === 'project' || work.kind === 'milestone')
      ? [{ reference, kind: work.kind, id: work.id }]
      : [];
  });
  const completions = ((await loadNativeScheduleCompletionFacts(tx, facts)) ?? []).flatMap(
    (fact) =>
      fact.id ? [{ id: fact.id, kind: 'task' as const, completedAt: fact.completedAt }] : [],
  );
  const complete = legacyScheduleTasksComplete(policy, mappings, completions);
  const required = new Set(mappings.map((mapping) => mapping.id));
  const instants = completions.flatMap((fact) =>
    required.has(fact.id) && fact.completedAt !== null
      ? [new Date(fact.completedAt).getTime()]
      : [],
  );
  return {
    state: complete ? 'completed' : 'open',
    completedAt: complete && instants.length ? new Date(Math.max(...instants)).toISOString() : null,
  };
}
