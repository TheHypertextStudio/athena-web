/** Shared handles, receipt aliases, and deferred-effect accumulators for object commands. */
import type { db, project } from '@docket/db';
import type { z } from 'zod';

import type {
  ObjectCommandIn,
  ObjectCommandReceipt,
  ObjectCommandResult,
} from '../../contracts/object-command';
import type { RecordedChange } from '../../mcp/change-set';
import type { RecordTaskChangesInput } from '../task-audit';
import type * as taskState from '../task-state';

/** One object-field or relation change inside a command receipt. */
export type CommandEntry = ObjectCommandReceipt['entries'][number];

/** A Drizzle transaction handle. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A database handle that may be the pool or an open transaction. */
export type Dbh = typeof db | Tx;

/** The database handle plus the tenant and actor every command check runs under. */
export interface CommandScope {
  readonly database: Dbh;
  readonly orgId: string;
  readonly actorId: string;
}

/** A command scope whose handle is the transaction currently applying the command. */
export interface TxScope extends CommandScope {
  readonly database: Tx;
}

/** A Task field change plus whether it moved the Task to a new assignee. */
export type TaskFieldChange = RecordTaskChangesInput & { readonly assignmentChanged: boolean };

/** Consequences collected inside the command transaction and emitted once it commits. */
export interface CommandEffects {
  readonly taskStateMutations: taskState.TaskStateMutation[];
  readonly timerStops: taskState.CompletedTaskTimerStop[];
  readonly taskFieldChanges: TaskFieldChange[];
  readonly projectStatusRows: (typeof project.$inferSelect)[];
}

/** Start an empty effect accumulator for one command execution. */
export function createCommandEffects(): CommandEffects {
  return {
    taskStateMutations: [],
    timerStops: [],
    taskFieldChanges: [],
    projectStatusRows: [],
  };
}

/** The response body a command produced, paired with the effects still to be emitted. */
export interface CommandExecution {
  readonly result: z.input<typeof ObjectCommandResult>;
  readonly effects: CommandEffects;
}

/** Everything one forward operation handler writes into while it runs. */
export interface ForwardContext {
  readonly scope: TxScope;
  readonly command: ObjectCommandIn;
  readonly entries: CommandEntry[];
  readonly audit: RecordedChange[];
  readonly effects: CommandEffects;
}
