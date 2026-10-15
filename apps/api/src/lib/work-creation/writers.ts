/** Non-expanding inserts shared by ordinary work creation and planned blueprint nodes. */
import { initiative, program, project, task, type milestone } from '@docket/db';
import type { TemplateTransaction } from '../templates/persistence';
import { insertPreparedMilestoneRows } from '../milestone-writes';

/** Physical work rows, retaining each kind's exact database shape. */
export interface WorkRowByKind {
  readonly initiative: typeof initiative.$inferSelect;
  readonly program: typeof program.$inferSelect;
  readonly project: typeof project.$inferSelect;
  readonly task: typeof task.$inferSelect;
  readonly milestone: typeof milestone.$inferSelect;
}

/** Prepared inserts; validation, authorization, IDs, and relative rules belong to the creation service. */
export interface WorkInsertByKind {
  readonly initiative: typeof initiative.$inferInsert;
  readonly program: typeof program.$inferInsert;
  readonly project: typeof project.$inferInsert;
  readonly task: typeof task.$inferInsert;
  readonly milestone: typeof milestone.$inferInsert;
}

/** A kind-correlated insert that never matches existing rows or recursively expands templates. */
export type ResolvedWorkInsert = {
  [K in keyof WorkInsertByKind]: { readonly kind: K; readonly values: WorkInsertByKind[K] };
}[keyof WorkInsertByKind];

/** One inserted row and its kind, suitable for a single enclosing creation receipt. */
export type InsertedWork = {
  [K in keyof WorkRowByKind]: {
    readonly kind: K;
    readonly id: string;
    readonly row: WorkRowByKind[K];
  };
}[keyof WorkRowByKind];

/**
 * Insert one prepared node without a transaction, receipt, resolver, or effect of its own.
 * @throws {Error} If a successful database insert unexpectedly returns no row.
 */
export async function insertWorkRow(
  tx: TemplateTransaction,
  input: ResolvedWorkInsert,
): Promise<InsertedWork> {
  switch (input.kind) {
    case 'initiative': {
      const [row] = await tx.insert(initiative).values(input.values).returning();
      if (!row) throw new Error('Initiative insert returned no row');
      return { kind: input.kind, id: row.id, row };
    }
    case 'program': {
      const [row] = await tx.insert(program).values(input.values).returning();
      if (!row) throw new Error('Program insert returned no row');
      return { kind: input.kind, id: row.id, row };
    }
    case 'project': {
      const [row] = await tx.insert(project).values(input.values).returning();
      if (!row) throw new Error('Project insert returned no row');
      return { kind: input.kind, id: row.id, row };
    }
    case 'task': {
      const [row] = await tx.insert(task).values(input.values).returning();
      if (!row) throw new Error('Task insert returned no row');
      return { kind: input.kind, id: row.id, row };
    }
    case 'milestone': {
      const [row] = await insertPreparedMilestoneRows(tx, [input.values]);
      if (!row) throw new Error('Milestone insert returned no row');
      return { kind: input.kind, id: row.id, row };
    }
  }
}
