import { sql } from 'drizzle-orm';
import { rawResultRows } from '../raw-result';
import type { TemplateTransaction } from '../templates/persistence';
import { requireNativeScheduleFacts, type NativeScheduleFacts } from './schedule-native-facts';
import { readNativeLegacyScheduleStatus } from './schedule-native-legacy-status';

/** Private actual-status summary; it never returns hidden work prose or caps a read-only forest at500 writes. */
export interface NativeScheduleStatus {
  readonly state: 'open' | 'completed' | 'canceled';
  readonly completedAt: string | null;
}
/** Aggregate living physical descendants under checked native roots; deleted work never becomes replacement work. */
export async function readNativeScheduleStatus(
  tx: TemplateTransaction,
  facts: NativeScheduleFacts,
): Promise<NativeScheduleStatus> {
  requireNativeScheduleFacts(tx, facts.authority);
  const legacy = await readNativeLegacyScheduleStatus(tx, facts);
  if (legacy) return legacy;
  const result = await tx.execute<{
    roots: number;
    canceled: boolean;
    terminal: boolean;
    completedAt: string | null;
  }>(sql`
    with recursive roots as (select * from jsonb_to_recordset(${JSON.stringify(facts.roots.map(({ kind, id }) => ({ kind, id })))}::jsonb) as r(kind text,id text)),
    items as (
      select 'task'::text kind,t.id,
        case when t.parent_task_id is not null then 'task' when t.milestone_id is not null then 'milestone' when t.project_id is not null then 'project' end parent_kind,
        coalesce(t.parent_task_id,t.milestone_id,t.project_id) parent_id,
        (t.completed_at is not null or s.category='completed') terminal_completed,
        (t.canceled_at is not null or s.category='canceled') terminal_canceled,t.completed_at
      from task t join work_status s on s.id=t.status_id and s.organization_id=t.organization_id where t.organization_id=${facts.organizationId} and t.archived_at is null
      union all select 'project',p.id,null,null,s.category='completed',s.category='canceled',null::timestamp from project p join work_status s on s.id=p.status_id and s.organization_id=p.organization_id where p.organization_id=${facts.organizationId} and p.archived_at is null
      union all select 'milestone',m.id,'project',m.project_id,true,false,null::timestamp from milestone m where m.organization_id=${facts.organizationId} and m.archived_at is null
    ), tree as (
      select i.*,true is_root from items i join roots r on r.id=i.id and r.kind=i.kind
      union select i.*,false from items i join tree parent on i.parent_kind=parent.kind and i.parent_id=parent.id
    ) select count(distinct id) filter(where is_root)::integer roots,
      coalesce(bool_or(is_root and terminal_canceled),false) canceled,
      coalesce(bool_and(terminal_completed or terminal_canceled),false) terminal,
      replace(max(completed_at)::text,' ','T') || 'Z' as "completedAt" from tree`);
  const [row] = rawResultRows<{
    roots: number;
    canceled: boolean;
    terminal: boolean;
    completedAt: string | null;
  }>(result);
  if (!row || !facts.roots.length || row.roots !== facts.roots.length)
    return { state: 'open', completedAt: null };
  return {
    state: row.canceled ? 'canceled' : row.terminal ? 'completed' : 'open',
    completedAt: row.completedAt,
  };
}
