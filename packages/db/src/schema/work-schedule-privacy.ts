import { sql } from 'drizzle-orm';
import { pgPolicy, type AnyPgColumn } from 'drizzle-orm/pg-core';

/** Private series require current resource visibility independently of creator attribution. */
export function scheduleSeriesPrivatePolicy(t: {
  organizationId: AnyPgColumn;
  ownerProgramId: AnyPgColumn;
  createdBy: AnyPgColumn;
}) {
  const visible = sql`docket_schedule_private_scope(${t.organizationId},${t.ownerProgramId},${t.createdBy})`;
  return pgPolicy('schedule_series_private', { for: 'all', using: visible, withCheck: visible });
}
/** Revision drafts inherit exactly their owning series' live private scope. */
export function scheduleRevisionPrivatePolicy(t: {
  organizationId: AnyPgColumn;
  seriesId: AnyPgColumn;
}) {
  const visible = sql`exists(select 1 from recurrence_series s where s.id=${t.seriesId} and s.organization_id=${t.organizationId} and docket_schedule_private_scope(s.organization_id,s.owner_program_id,s.created_by))`;
  return pgPolicy('schedule_revision_private', { for: 'all', using: visible, withCheck: visible });
}
/** Native claims inherit private series scope; standalone historical receipts require private invocation view. */
export function scheduleOccurrencePrivatePolicy(t: {
  organizationId: AnyPgColumn;
  seriesId: AnyPgColumn;
  blueprintInvocationId: AnyPgColumn;
}) {
  const visible = sql`${t.organizationId}=nullif(current_setting('docket.organization_id',true),'') and ((${t.seriesId} is not null and exists(select 1 from recurrence_series s where s.id=${t.seriesId} and s.organization_id=${t.organizationId} and docket_schedule_private_scope(s.organization_id,s.owner_program_id,s.created_by))) or (${t.seriesId} is null and (docket_schedule_scope_capability(${t.organizationId},null,'manage') or (docket_schedule_scope_capability(${t.organizationId},null,'view') and exists(select 1 from work_template_blueprint_invocation i where i.id=${t.blueprintInvocationId} and i.organization_id=${t.organizationId} and i.owner_actor_id=nullif(current_setting('docket.actor_id',true),''))))))`;
  return pgPolicy('blueprint_occurrence_private', {
    for: 'all',
    using: visible,
    withCheck: visible,
  });
}
