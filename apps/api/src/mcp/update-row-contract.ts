/** Typed context and outcomes shared by bulk-update row operations. */
import type { z } from 'zod';
import type { McpActor } from './auth';
import type { FieldDiff } from './catalog-rows';
import type { RecordedChange } from './change-set';
import type { WorkEntity } from './list-work';
import type { MilestoneDecision } from './task-milestone';
import type { LabelEdit } from './update-labels';
import type { ResolvedRefs } from './update-refs';
import type { CycleTarget, InitiativeEdit } from './update-relations';
import type { updateSetFields } from './update-tool-contract';

type UpdateSet = z.infer<z.ZodObject<typeof updateSetFields>>;

/** Everything a row write needs that is the same for every row in the call. */
export interface RowContext {
  readonly actorCtx: McpActor;
  readonly entity: WorkEntity;
  readonly orgId: string;
  readonly set: UpdateSet;
  readonly refs: ResolvedRefs;
  readonly fiscalYearStartMonth: number;
  readonly containerStatus: { statusId: string; status: string } | undefined;
  readonly labelEdit: LabelEdit | undefined;
  readonly cycle: CycleTarget | undefined;
  readonly initiativeEdit: InitiativeEdit | undefined;
  /** Each row's milestone patch, decided before any row is written. */
  readonly milestoneFor: (id: string) => MilestoneDecision;
}

/** One written row as the report card shows it. */
export interface RowReport {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly fields: FieldDiff[];
}

/** One row left alone, and why. */
export interface RowSkip {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
}

/** What happened to one row: skipped, written, or null when it vanished mid-call. */
export type RowOutcome =
  | { readonly skipped: RowSkip }
  | { readonly report: RowReport; readonly changes: RecordedChange[] }
  | null;
