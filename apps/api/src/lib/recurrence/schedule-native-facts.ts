import {
  processOccurrence,
  recurrenceSeries,
  recurrenceSeriesRevision,
  type BlueprintOccurrenceRoot,
  type Database,
} from '@docket/db';
import { AcceptedScheduleClaim } from '@docket/work/work-schedule-claim';
import { and, eq, sql } from 'drizzle-orm';
import type { ActorCtx } from '../../context';
import { CapabilityError, NotFoundError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import type { BlueprintSnapshotRow } from '../work-template-blueprints/snapshot-types';
import {
  parseScheduleDocument,
  scheduleDraftFingerprint,
  type ScheduleDocument,
} from './schedule-compiler';
import { loadNativeScheduleOrigins } from './schedule-native-origins';
import {
  resolveNativeScheduleCaller,
  type NativeScheduleCallerRequest,
} from './schedule-native-caller';

/** An opaque capability for this transaction's exact applied native occurrence. */
export interface NativeScheduleSnapshotAuthority {
  readonly kind: 'native-schedule-occurrence';
  readonly proof: object;
}
/** Persisted roots and their saved closure; no expected path manufactures missing physical work. */
export interface NativeScheduleFacts {
  readonly authority: NativeScheduleSnapshotAuthority;
  readonly organizationId: string;
  readonly caller: ActorCtx | null;
  readonly series: typeof recurrenceSeries.$inferSelect;
  readonly revision: typeof recurrenceSeriesRevision.$inferSelect;
  readonly occurrence: typeof processOccurrence.$inferSelect;
  readonly document: ScheduleDocument;
  readonly timezone: string;
  readonly roots: readonly BlueprintOccurrenceRoot[];
  readonly originKeys: ReadonlyMap<string, ReadonlySet<string>>;
}
const authorities = new WeakMap<
  object,
  { readonly tx: TemplateTransaction; readonly facts: NativeScheduleFacts }
>();
/** Require a checked capability on its original transaction; copied JSON and stale transactions fail. */
export function requireNativeScheduleFacts(
  tx: TemplateTransaction,
  authority: NativeScheduleSnapshotAuthority,
): NativeScheduleFacts {
  const registered = authorities.get(authority.proof);
  if (registered?.tx !== tx || registered.facts.authority !== authority)
    throw new CapabilityError();
  return registered.facts;
}
/** Find an actual immutable native root or child receipt without consulting retired instance maps. */
export async function findNativeScheduleOccurrence(
  database: Database,
  organizationId: string,
  reference: { readonly kind: 'task' | 'project' | 'milestone'; readonly id: string },
): Promise<string | null> {
  const [row] = await database
    .select({ id: processOccurrence.id })
    .from(processOccurrence)
    .where(
      and(
        eq(processOccurrence.organizationId, organizationId),
        sql`${processOccurrence.acceptedClaim} is not null and ${processOccurrence.blueprintAppliedAt} is not null`,
        sql`exists(select 1 from jsonb_array_elements(${processOccurrence.blueprintRootRefs}) r where
      (r->>'kind'=${reference.kind} and r->>'id'=${reference.id}) or exists(select 1 from jsonb_array_elements(r->'selectedWork') w where w->>'kind'=${reference.kind} and w->>'id'=${reference.id}))`,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}
async function lockedNativeRows(
  tx: TemplateTransaction,
  input: NativeScheduleCallerRequest & { readonly occurrenceId: string },
) {
  const where = and(
    eq(processOccurrence.id, input.occurrenceId),
    eq(processOccurrence.organizationId, input.organizationId),
  );
  const [initial] = await tx.select().from(processOccurrence).where(where).limit(1);
  if (!initial?.seriesId || !initial.seriesRevisionId)
    throw new NotFoundError('Schedule run not found');
  const [series] = await tx
    .select()
    .from(recurrenceSeries)
    .where(
      and(
        eq(recurrenceSeries.id, initial.seriesId),
        eq(recurrenceSeries.organizationId, input.organizationId),
      ),
    )
    .for('update')
    .limit(1);
  const [revision] = await tx
    .select()
    .from(recurrenceSeriesRevision)
    .where(
      and(
        eq(recurrenceSeriesRevision.id, initial.seriesRevisionId),
        eq(recurrenceSeriesRevision.seriesId, initial.seriesId),
        eq(recurrenceSeriesRevision.organizationId, input.organizationId),
      ),
    )
    .for('update')
    .limit(1);
  const [occurrence] = await tx
    .select()
    .from(processOccurrence)
    .where(where)
    .for('update')
    .limit(1);
  if (
    !series ||
    !revision?.scheduleDraft ||
    !occurrence?.blueprintAppliedAt ||
    !occurrence.blueprintRootRefs ||
    occurrence.seriesRevisionId !== revision.id ||
    occurrence.seriesId !== series.id
  )
    throw new NotFoundError('Schedule run not found');
  return { series, revision, occurrence, roots: occurrence.blueprintRootRefs };
}
/** Lock native series/revision/occurrence in the shared order and register only persisted exact authority. */
export async function authorizeNativeScheduleOccurrence(
  tx: TemplateTransaction,
  input: NativeScheduleCallerRequest & { readonly occurrenceId: string },
): Promise<NativeScheduleFacts> {
  const { series, revision, occurrence, roots } = await lockedNativeRows(tx, input);
  const document = parseScheduleDocument(revision.scheduleDraft);
  const claim = AcceptedScheduleClaim.parse(occurrence.acceptedClaim);
  if (
    claim.seriesRevisionId !== revision.id ||
    claim.sourceInvocationId !== revision.blueprintInvocationId ||
    claim.draftFingerprint !== scheduleDraftFingerprint(document)
  )
    throw new CapabilityError();
  const caller = await resolveNativeScheduleCaller(
    tx,
    { series, revision, document, roots },
    input,
  );
  const authority = Object.freeze({ kind: 'native-schedule-occurrence' as const, proof: {} });
  const facts: NativeScheduleFacts = {
    authority,
    organizationId: input.organizationId,
    caller,
    series,
    revision,
    occurrence,
    document,
    timezone: claim.timezone,
    roots,
    originKeys: await loadNativeScheduleOrigins(tx, input.organizationId, roots),
  };
  authorities.set(authority.proof, { tx, facts });
  return facts;
}
/** Nullable attribution sees only actual accepted roots and still-contained children with matching immutable origin. */
export function nativeScheduleSnapshotFilter(
  facts: NativeScheduleFacts,
): (entry: BlueprintSnapshotRow) => boolean {
  const roots = new Set(facts.roots.map((root) => `${root.kind}:${root.id}`));
  const selected = new Map<string, NonNullable<BlueprintOccurrenceRoot['selectedWork']>[number]>(
    facts.roots.flatMap((root) =>
      (root.selectedWork ?? []).map((work) => [`${work.kind}:${work.id}`, work] as const),
    ),
  );
  const included = new Set<string>();
  return ({ work, parent }) => {
    const key = `${work.kind}:${work.id}`;
    const original = selected.get(key);
    const child =
      original &&
      parent &&
      included.has(`${parent.kind}:${parent.id}`) &&
      facts.originKeys
        .get(work.id)
        ?.has(`${work.row.blueprintSourceVersionId}:${work.row.blueprintStepId}`) &&
      JSON.stringify(work.row.blueprintPath) === JSON.stringify(original.path) &&
      work.row.blueprintParentKind === parent.kind &&
      work.row.blueprintParentId === parent.id;
    if (!roots.has(key) && !child) return false;
    included.add(key);
    return true;
  };
}
