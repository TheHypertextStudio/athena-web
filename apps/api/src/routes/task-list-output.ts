import { labelsForSubjects } from '../lib/labels';
import { sourcePeopleForSubjects } from '../lib/identity/source-people';
import { toOut, type TaskRow } from './task-helpers';

/** Hydrate a task page with batched labels and source person evidence. */
export async function taskListOutput(
  orgId: string,
  rows: TaskRow[],
): Promise<ReturnType<typeof toOut>[]> {
  const ids = rows.map((row) => row.id);
  const labels = await labelsForSubjects('task', orgId, ids);
  const sources = await sourcePeopleForSubjects(orgId, 'task', ids);
  return rows.map((row) => toOut(row, labels.get(row.id) ?? [], sources.get(row.id) ?? []));
}
