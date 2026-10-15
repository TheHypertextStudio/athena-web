import type { Database } from './client';
import { backfillTemplateDefinitions } from './work-template-migration/definitions';
import { backfillTemplateWork } from './work-template-migration/work';
import { provisionTemplateWorkspaces } from './work-template-migration/workspaces';

/** Durable batch boundaries in the work-template data checkpoint. */
export type WorkTemplateBackfillPhase =
  'workspaces' | 'definitions' | 'initiative' | 'program' | 'project' | 'task';

/** A batch has committed before this notification is delivered. */
export interface WorkTemplateBackfillProgress {
  readonly phase: WorkTemplateBackfillPhase;
  readonly count: number;
}

/** Migration controls; interruption after a committed batch is safe to resume. */
export interface WorkTemplateBackfillOptions {
  readonly batchSize?: number;
  readonly onBatch?: (progress: WorkTemplateBackfillProgress) => void | Promise<void>;
}

/** Committed batch observer used by the checkpoint's phases. */
export type WorkTemplateBackfillObserver = (
  progress: WorkTemplateBackfillProgress,
) => Promise<void>;

/** Convert retained definitions and work without changing authored bodies or private draft scope. */
export async function backfillWorkTemplateIdentity(
  database: Database,
  options: WorkTemplateBackfillOptions = {},
): Promise<Record<WorkTemplateBackfillPhase, number>> {
  const batchSize = options.batchSize ?? 250;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new RangeError('Work-template backfill batches must contain between 1 and 1000 rows.');
  }
  const counts: Record<WorkTemplateBackfillPhase, number> = {
    workspaces: 0,
    definitions: 0,
    initiative: 0,
    program: 0,
    project: 0,
    task: 0,
  };
  for (let round = 0; round < 10; round++) {
    let changed = 0;
    const committed: WorkTemplateBackfillObserver = async (progress) => {
      counts[progress.phase] += progress.count;
      changed += progress.count;
      await options.onBatch?.(progress);
    };
    await provisionTemplateWorkspaces(database, batchSize, committed);
    await backfillTemplateDefinitions(database, batchSize, committed);
    for (const kind of ['initiative', 'program', 'project', 'task'] as const) {
      await backfillTemplateWork(database, kind, batchSize, committed);
    }
    if (changed === 0) return counts;
  }
  throw new Error(
    'Work-template backfill did not settle; quiesce legacy writers before enforcement.',
  );
}
