import { processOccurrence, type recurrenceSeriesRevision, template } from '@docket/db';
import { expandBlueprint } from '@docket/work/blueprints';
import { AcceptedScheduleClaim, type AcceptedScheduleRoot } from '@docket/work/work-schedule-claim';
import { WorkScheduleRevisionFallback } from '@docket/work/work-schedule-fallback';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { ConflictError } from '../../error';
import {
  parseScheduleDocument,
  scheduleDocumentRoots,
  scheduleDraftFingerprint,
} from '../recurrence/schedule-compiler';
import { readBlueprintClosure } from '../work-template-blueprints/resolve';
import type { TemplateTransaction } from './persistence';

async function retainedRoots(
  tx: TemplateTransaction,
  revision: typeof recurrenceSeriesRevision.$inferSelect,
): Promise<readonly AcceptedScheduleRoot[]> {
  const [latest] = await tx
    .select({ claim: processOccurrence.acceptedClaim })
    .from(processOccurrence)
    .where(
      and(
        eq(processOccurrence.organizationId, revision.organizationId),
        eq(processOccurrence.seriesId, revision.seriesId),
        eq(processOccurrence.seriesRevisionId, revision.id),
        eq(processOccurrence.runKind, 'scheduled'),
        isNotNull(processOccurrence.acceptedClaim),
      ),
    )
    .orderBy(desc(processOccurrence.acceptanceOrdinal))
    .limit(1);
  const retained = latest
    ? AcceptedScheduleClaim.parse(latest.claim)
    : WorkScheduleRevisionFallback.parse(revision.authoringFallback);
  if (
    retained.seriesRevisionId !== revision.id ||
    retained.sourceInvocationId !== revision.blueprintInvocationId ||
    retained.draftFingerprint !==
      scheduleDraftFingerprint(parseScheduleDocument(revision.scheduleDraft))
  )
    throw new ConflictError('The schedule retained selection changed.');
  return retained.roots;
}

type ScheduleRoot = ReturnType<typeof scheduleDocumentRoots>[number];
function matchesRetainedRoot(
  saved: AcceptedScheduleRoot | undefined,
  root: ScheduleRoot,
  targetId: string,
): boolean {
  const selection = root.draft.template;
  if (
    saved?.workTypeId !== selection.workTypeId ||
    saved.kind !== selection.targetType ||
    (selection.selection.kind === 'pinned' &&
      saved.versionId !== selection.selection.workTypeVersionId) ||
    JSON.stringify(saved.optionalChoices) !== JSON.stringify(root.draft.optionalChoices)
  )
    throw new ConflictError('The schedule retained selection changed.');
  return saved.resolvedManifest.some((entry) => entry.workTypeId === targetId);
}
async function rootReferences(
  tx: TemplateTransaction,
  revision: typeof recurrenceSeriesRevision.$inferSelect,
  root: ScheduleRoot,
  targetId: string,
): Promise<boolean> {
  const selection = root.draft.template;
  const [definition] = await tx
    .select({ state: template.publicationState, archivedAt: template.archivedAt })
    .from(template)
    .where(
      and(
        eq(template.organizationId, revision.organizationId),
        eq(template.id, selection.workTypeId),
      ),
    )
    .limit(1);
  if (!definition) throw new ConflictError('The schedule template is unavailable.');
  if (definition.archivedAt !== null || definition.state === 'archived') {
    const retained = await retainedRoots(tx, revision);
    return matchesRetainedRoot(
      retained.find((entry) => entry.key === root.key),
      root,
      targetId,
    );
  }
  const graph = await readBlueprintClosure(tx, {
    organizationId: revision.organizationId,
    kind: selection.targetType,
    workTypeId: selection.workTypeId,
    workTypeVersionId:
      selection.selection.kind === 'pinned' ? selection.selection.workTypeVersionId : undefined,
  });
  return expandBlueprint(graph, root.draft.optionalChoices).nodes.some(
    (node) => node.selected && node.workTypeId === targetId,
  );
}
/** Match selected work from the current live graph, or the exact persisted closure for an archived root. */
export async function nativeScheduleReferences(
  tx: TemplateTransaction,
  revision: typeof recurrenceSeriesRevision.$inferSelect,
  targetId: string,
): Promise<boolean> {
  const document = parseScheduleDocument(revision.scheduleDraft);
  for (const root of scheduleDocumentRoots(document)) {
    if (await rootReferences(tx, revision, root, targetId)) return true;
  }
  return false;
}
