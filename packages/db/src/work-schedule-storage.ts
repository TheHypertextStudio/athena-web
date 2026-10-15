import { WorkScheduleDraft } from '@docket/work/work-schedule';
import { WorkScheduleForest } from '@docket/work/work-schedule-forest';
import { WorkScheduleRevisionFallback } from '@docket/work/work-schedule-fallback';
import { sql } from 'drizzle-orm';
import { genId } from './id';
import {
  migrationRows,
  type BlueprintMigrationConnection,
} from './work-template-blueprint-migration/query';

/** Strict native invocation write; historical immutable documents use their unchanged representation. */
export async function persistScheduleForestInvocation(
  connection: BlueprintMigrationConnection,
  input: { organizationId: string; ownerActorId: string | null; document: WorkScheduleForest },
): Promise<string> {
  const document = WorkScheduleForest.parse(input.document),
    id = genId();
  await connection.execute(
    sql`insert into work_template_blueprint_invocation(id,organization_id,owner_actor_id,manifest,overrides) values(${id},${input.organizationId},${input.ownerActorId},${JSON.stringify(document)}::jsonb,'[]'::jsonb)`,
  );
  return id;
}
/** Register a private native schedule or forest draft once on an existing canonical revision. */
export async function registerScheduleDraft(
  connection: BlueprintMigrationConnection,
  input: {
    organizationId: string;
    seriesRevisionId: string;
    draft: WorkScheduleDraft | WorkScheduleForest;
  },
): Promise<void> {
  const draft =
    input.draft.kind === 'forest'
      ? WorkScheduleForest.parse(input.draft)
      : WorkScheduleDraft.parse(input.draft);
  const rows = await migrationRows<{ id: string }>(
    connection,
    sql`update recurrence_series_revision set schedule_draft=${JSON.stringify(draft)}::jsonb where id=${input.seriesRevisionId} and organization_id=${input.organizationId} and schedule_draft is null returning id`,
  );
  if (rows.length !== 1)
    throw new Error('Schedule draft registration requires one unregistered revision.');
}
/** Independently register the complete validated authoring closure; never replaces later occurrence claims. */
export async function registerScheduleAuthoringFallback(
  connection: BlueprintMigrationConnection,
  input: { organizationId: string; fallback: WorkScheduleRevisionFallback },
): Promise<void> {
  const fallback = WorkScheduleRevisionFallback.parse(input.fallback);
  const rows = await migrationRows<{ id: string }>(
    connection,
    sql`update recurrence_series_revision set authoring_fallback=${JSON.stringify(fallback)}::jsonb where id=${fallback.seriesRevisionId} and organization_id=${input.organizationId} and authoring_fallback is null returning id`,
  );
  if (rows.length !== 1)
    throw new Error('Schedule fallback registration requires one unregistered revision.');
}
