import { invocationRevision } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import type { RecurrenceSeriesCreate } from '../../contracts/recurrence';
import type { TemplateTransaction } from '../templates/persistence';
import { currentBlueprintPlanningTimezone } from '../work-template-blueprints/context';
import { canonicalDefinitionHead } from './canonical-definition';
import {
  loadCanonicalPrivatePublication,
  bindCanonicalPrivateSchedule,
} from './private-definition-binding';
import {
  createWorkScheduleInTransaction,
  appendBoundPrivateScheduleRevision,
} from './schedule-authoring';

/** Actual persisted publication kind; retained history still requires its separate checked conversion factory. */
export async function hasAuthoredPrivatePublication(
  tx: TemplateTransaction,
  organizationId: string,
  definitionId: string,
): Promise<boolean> {
  const head = await canonicalDefinitionHead(tx, { organizationId, definitionId });
  if (!head?.publishedInvocationId) return false;
  const [publication] = await tx
    .select({ origin: invocationRevision.origin })
    .from(invocationRevision)
    .where(
      and(
        eq(invocationRevision.headId, head.id),
        eq(invocationRevision.organizationId, organizationId),
        eq(invocationRevision.invocationId, head.publishedInvocationId),
      ),
    )
    .limit(1);
  return publication?.origin === 'authored';
}

/**
 * Install one current authorized private publication through the ordinary schedule preflight/fallback writer.
 * The publication factory binds exact aliases to this caller and transaction; input JSON cannot supply authority.
 */
export async function createCanonicalPrivateScheduleInTransaction(
  tx: TemplateTransaction,
  input: {
    readonly organizationId: string;
    readonly actorId: string;
    readonly series: RecurrenceSeriesCreate;
    readonly effectiveFrom: string;
  },
): Promise<string> {
  const { organizationId, actorId, series } = input;
  const publication = await loadCanonicalPrivatePublication(tx, {
    organizationId,
    actorId,
    definitionId: series.processDefinitionId,
  });
  const timezone =
    series.trigger.kind === 'calendar'
      ? series.trigger.schedule.timezone
      : await currentBlueprintPlanningTimezone(tx, organizationId, actorId);
  const document = bindCanonicalPrivateSchedule(
    tx,
    { orgId: organizationId, actorId },
    publication,
    timezone,
  );
  const installed = await createWorkScheduleInTransaction(
    tx,
    {
      organizationId,
      actorId,
      name: series.name,
      document,
      trigger: series.trigger,
      effectiveFrom: input.effectiveFrom,
    },
    publication,
  );
  return installed.series.id;
}

/** Register an authorized current private publication for a future boundary already locked by its owning series service. */
export async function appendCanonicalPrivateScheduleInTransaction(
  tx: TemplateTransaction,
  input: {
    readonly organizationId: string;
    readonly actorId: string;
    readonly definitionId: string;
    readonly seriesId: string;
    readonly seriesName: string;
    readonly ownerProgramId: string | null;
    readonly number: number;
    readonly effectiveFrom: string;
    readonly trigger: RecurrenceSeriesCreate['trigger'];
  },
): Promise<void> {
  const publication = await loadCanonicalPrivatePublication(tx, input);
  const timezone =
    input.trigger.kind === 'calendar'
      ? input.trigger.schedule.timezone
      : await currentBlueprintPlanningTimezone(tx, input.organizationId, input.actorId);
  const document = bindCanonicalPrivateSchedule(
    tx,
    { orgId: input.organizationId, actorId: input.actorId },
    publication,
    timezone,
  );
  await appendBoundPrivateScheduleRevision(
    tx,
    { ...input, name: input.seriesName, document },
    { seriesId: input.seriesId, number: input.number, publication },
  );
}
