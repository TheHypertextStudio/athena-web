import type { NativeScheduleDateOwnership } from '@docket/db';
import { BlueprintError, type BlueprintDateField } from '@docket/work/blueprints';
import { NotFoundError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import { loadBlueprintSnapshot } from '../work-template-blueprints/snapshot';
import type {
  AuthorizedBlueprintSnapshot,
  BlueprintWorkRef,
} from '../work-template-blueprints/snapshot-types';
import type { NativeScheduleFacts } from './schedule-native-facts';

function plannedSource(entry: NativeScheduleDateOwnership): string | null {
  if (entry.anchor.kind === 'work') return entry.anchor.id;
  return entry.anchor.kind === 'field' && entry.anchor.source.kind === 'work_date'
    ? entry.anchor.source.work.id
    : null;
}
async function readPrerequisite(
  tx: TemplateTransaction,
  facts: NativeScheduleFacts,
  source: BlueprintWorkRef,
): Promise<AuthorizedBlueprintSnapshot | null> {
  try {
    return await loadBlueprintSnapshot(tx, facts.authority, source, {
      scope: 'reference',
      forUpdate: true,
      access: 'view',
    });
  } catch (error) {
    // Reference absence means a deleted/archived row. Capability failures still propagate.
    const v2 = facts.document.kind === 'forest' && facts.document.revision === 2;
    if (!v2 || !(error instanceof NotFoundError)) throw error;
    return null;
  }
}
/** Read only needed physical planned-date prerequisites, independently from actual completion facts. */
export async function loadNativeSchedulePrerequisites(
  tx: TemplateTransaction,
  input: {
    readonly facts: NativeScheduleFacts;
    readonly reference: BlueprintWorkRef;
    readonly explicitDates: readonly BlueprintDateField[];
    readonly affected: ReadonlySet<string>;
    readonly snapshots: Map<string, AuthorizedBlueprintSnapshot>;
  },
): Promise<void> {
  const loaded = new Set(
    [...input.snapshots.values()].flatMap((snapshot) => snapshot.nodes.map((node) => node.id)),
  );
  const selected =
    input.facts.occurrence.scheduleDateOwnership?.filter(
      (entry) =>
        !entry.manual &&
        input.affected.has(entry.id) &&
        !(entry.id === input.reference.id && input.explicitDates.includes(entry.field)),
    ) ?? [];
  for (const entry of selected) {
    const id = plannedSource(entry);
    if (!id || loaded.has(id)) continue;
    const source = input.facts.roots
      .flatMap((root) => [root, ...(root.selectedWork ?? [])])
      .find((work) => work.id === id);
    if (!source)
      throw new BlueprintError('blueprint_invalid', 'Missing accepted private prerequisite.');
    const snapshot = await readPrerequisite(tx, input.facts, source);
    if (snapshot) {
      input.snapshots.set(`prerequisite:${id}`, snapshot);
      loaded.add(id);
    }
  }
}
