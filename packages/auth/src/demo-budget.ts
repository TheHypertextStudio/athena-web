/** Durable, shared abuse budgets for operator-provisioned reviewer workspaces. */
import { actor, db, demo, demoWorkspace, demoBudget, user } from '@docket/db';
import { eq, sql } from 'drizzle-orm';

/** A verified identity; callers must never take these IDs from an unverified request body. */
export type DemoBudgetSubject =
  { readonly userId: string } | { readonly organizationId: string } | { readonly demoId: string };
/** A unit of reviewer work, charged before its side effects. */
export interface DemoBudgetCharge {
  readonly kind: 'requests' | 'writes' | 'sign-ins' | 'generations' | 'bytes' | 'expensive';
  readonly amount?: number;
}
/** Database transaction used to keep admission and quota consumption atomic. */
export type DemoBudgetTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const RULES = {
  requests: [
    [60_000, 120],
    [86_400_000, 2_000],
  ],
  writes: [
    [60_000, 30],
    [86_400_000, 250],
  ],
  'sign-ins': [
    [60_000, 10],
    [86_400_000, 60],
  ],
  generations: [
    [60_000, 3],
    [86_400_000, 12],
  ],
  bytes: [[86_400_000, 20 * 1024 * 1024]],
  expensive: [
    [60_000, 3],
    [86_400_000, 12],
  ],
} as const;

/** A rejected reviewer budget, translated to HTTP 429 by the relevant transport. */
export class DemoBudgetExceeded extends Error {
  readonly retryAfter: number;
  constructor(retryAfter: number) {
    super('Reviewer usage limit reached.');
    this.name = 'DemoBudgetExceeded';
    this.retryAfter = Math.max(1, Math.ceil(retryAfter));
  }
}

/** Find and lock the shared demo, including disabled demos whose existing sessions still exist. */
export async function lockDemoBudget(
  tx: DemoBudgetTransaction,
  subject: DemoBudgetSubject,
): Promise<string | null> {
  if ('demoId' in subject) {
    const [row] = await tx
      .select({ id: demo.id })
      .from(demo)
      .where(eq(demo.id, subject.demoId))
      .for('update');
    return row?.id ?? null;
  }
  if ('userId' in subject) {
    const [listed] = await tx
      .select({ id: demo.id })
      .from(demo)
      .innerJoin(user, sql`${user.email} = any(${demo.allowedEmails})`)
      .where(eq(user.id, subject.userId))
      .limit(1);
    if (listed) return lockDemoBudget(tx, { demoId: listed.id });
  }
  if ('organizationId' in subject) {
    const [workspace] = await tx
      .select({ id: demoWorkspace.demoId })
      .from(demoWorkspace)
      .where(eq(demoWorkspace.organizationId, subject.organizationId))
      .limit(1);
    return workspace ? lockDemoBudget(tx, { demoId: workspace.id }) : null;
  }
  const [row] = await tx
    .select({ id: demoWorkspace.demoId })
    .from(demoWorkspace)
    .innerJoin(actor, eq(actor.organizationId, demoWorkspace.organizationId))
    .where(eq(actor.userId, subject.userId))
    .limit(1);
  if (!row) return null;
  return lockDemoBudget(tx, { demoId: row.id });
}

async function consumeWindow(
  tx: DemoBudgetTransaction,
  demoId: string,
  charge: DemoBudgetCharge,
  window: readonly [number, number],
  now: number,
): Promise<void> {
  const [duration, limit] = window;
  const amount = charge.amount ?? 1;
  const started = Math.floor(now / duration) * duration;
  const id = `docket:demo:${demoId}:${charge.kind}:${duration}`;
  const [row] = await tx.select().from(demoBudget).where(eq(demoBudget.id, id)).limit(1);
  const used = row?.lastRequest === started ? row.count : 0;
  if (!Number.isSafeInteger(amount) || amount < 0 || used + amount > limit) {
    throw new DemoBudgetExceeded((started + duration - now) / 1000);
  }
  await tx
    .insert(demoBudget)
    .values({ id, demoId, key: id, count: used + amount, lastRequest: started })
    .onConflictDoUpdate({
      target: demoBudget.id,
      set: { count: used + amount, lastRequest: started },
    });
}

/**
 * Charge the whole admission atomically; rejected admissions leave all counters unchanged.
 * @returns The demo ID, or null for an ordinary account/workspace.
 */
export async function consumeDemoBudgetInTransaction(
  tx: DemoBudgetTransaction,
  subject: DemoBudgetSubject,
  charges: readonly DemoBudgetCharge[],
  now = Date.now(),
): Promise<string | null> {
  const demoId = await lockDemoBudget(tx, subject);
  if (!demoId) return null;
  for (const charge of charges)
    for (const window of RULES[charge.kind]) await consumeWindow(tx, demoId, charge, window, now);
  return demoId;
}

/** Charge verified reviewer work across IP addresses, sessions and API instances. */
export async function consumeDemoBudget(
  subject: DemoBudgetSubject,
  charges: readonly DemoBudgetCharge[],
  now = Date.now(),
): Promise<string | null> {
  return db.transaction((tx) => consumeDemoBudgetInTransaction(tx, subject, charges, now));
}
