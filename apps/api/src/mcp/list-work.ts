/**
 * `@docket/api` — the filtered work query behind the `list_work` tool.
 *
 * @remarks
 * Replaces `run_view`, which advertised "an ad-hoc, permission-filtered query" and accepted no
 * filters at all — it was a reverse-chronological dump, so an agent asking "what's blocked?" or
 * "what's assigned to Sarah in the migration project?" had no way to express either.
 *
 * The filter surface and per-entity applicability live in `./list-work-contract`; the two query
 * bodies live in `./list-work-tasks` and `./list-work-containers`, which share the contract rather
 * than each other.
 */
import { assertApplicable, type ListWorkQuery, type WorkPageRow } from './list-work-contract';
import { listContainers } from './list-work-containers';
import { listTasks } from './list-work-tasks';

export {
  listWorkFilters,
  WORK_ENTITIES,
  WorkRow,
  type ListWorkInput,
  type WorkEntity,
} from './list-work-contract';
export { isTaskRowVisible } from './list-work-tasks';

/**
 * List work matching a filter set.
 *
 * @param query - The call being served.
 * @returns the matching rows, one over `limit` when more remain.
 * @throws {ValidationError} When a filter does not apply to the requested entity.
 */
export async function listWork(query: ListWorkQuery): Promise<WorkPageRow[]> {
  assertApplicable(query.entity, query.input);
  if (query.entity === 'task') return listTasks(query);
  return listContainers({ ...query, entity: query.entity });
}
