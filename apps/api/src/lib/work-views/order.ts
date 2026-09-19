import { workItemOrder } from '@docket/db';
import { satisfies, type Capability } from '@docket/authz';
import {
  FractionalRank,
  WorkViewOrderResponse,
  type WorkViewOrderRequest,
  type WorkViewOrderResponse as WorkViewOrderResponseValue,
} from '@docket/work/work-view-contract';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { ApiError, CapabilityError, NotFoundError } from '../../error';
import { assertMilestoneInOrg, assertTaskCapability, loadTask } from '../../routes/task-helpers';
import { compileAuthorizationSql } from './authorization-sql';
import { compileRosterCtes } from './context-sql';
import { mutateGroup } from './order-group';
import { betweenRanks } from './order-rank';
import {
  callerRow,
  countRow,
  executeOne,
  executeRows,
  nullableStringValue,
  type ReorderWorkViewInput,
  type WorkViewTransaction,
} from './order-runtime';

const REBALANCE_HALF_WINDOWS = [16, 32, 64] as const;
function contextId(context: WorkViewOrderRequest['context'], organizationId: string): string {
  switch (context.kind) {
    case 'organization':
      return organizationId;
    case 'team':
      return context.teamId;
    case 'project':
      return context.projectId;
    case 'program':
      return context.programId;
    case 'initiative':
      return context.initiativeId;
  }
}

/** A reorder already known to target initiatives, so its context is the initiative one. */
type InitiativeReorderInput = ReorderWorkViewInput & {
  readonly request: Extract<WorkViewOrderRequest, { target: 'initiative' }>;
};

/**
 * Narrow an initiative reorder to the subtree the request's context names.
 *
 * @param input - The reorder request.
 * @param callerUserId - The acting person's Better Auth user id.
 * @returns The `where` fragment that scopes `initiative e` to that context.
 */
function initiativeContextScope(input: InitiativeReorderInput, callerUserId: string | null): SQL {
  const context = input.request.context;
  if (context.kind === 'organization') return sql`e.organization_id=${input.organizationId}`;
  const rootId = context.initiativeId;
  const rootAuthorized = sql`exists (
    select 1 from initiative e where e.id=${rootId}
      and ${compileAuthorizationSql('initiative', input.organizationId, input.actorId, callerUserId)}
  )`;
  return sql`(e.id=${rootId} or (${rootAuthorized} and exists (
    with recursive ancestors(id) as (
      select e.id
      union
      select edge.parent_initiative_id
      from initiative_hierarchy_link edge
      join ancestors child on child.id=edge.child_initiative_id
      where edge.context_organization_id=${input.organizationId}
    )
    select 1 from ancestors where id=${rootId}
  )))`;
}

/**
 * Count how many of the named initiatives the caller may see inside the request's context.
 *
 * @param input - The reorder request.
 * @param callerUserId - The acting person's Better Auth user id.
 * @param idList - The `in (…)` fragment naming the items.
 * @returns How many of them resolved.
 */
async function visibleInitiativeCount(
  input: InitiativeReorderInput,
  callerUserId: string | null,
  idList: SQL,
): Promise<number> {
  const found = await executeOne(
    input.database,
    sql`select count(distinct e.id)::int count from initiative e
      where e.id in (${idList})
      and ${compileAuthorizationSql('initiative', input.organizationId, input.actorId, callerUserId)}
      and ${initiativeContextScope(input, callerUserId)}`,
    countRow,
  );
  return found.count;
}

/**
 * Count how many of the named items the caller may see inside the request's roster context.
 *
 * @param input - The reorder request.
 * @param callerUserId - The acting person's Better Auth user id.
 * @param idList - The `in (…)` fragment naming the items.
 * @returns How many of them resolved.
 */
async function visibleRosterCount(
  input: ReorderWorkViewInput,
  callerUserId: string | null,
  idList: SQL,
): Promise<number> {
  const scope = sql`e.id in (${idList})`;
  const ctes = compileRosterCtes({
    target: input.request.target,
    context: input.request.context,
    organizationId: input.organizationId,
    actorId: input.actorId,
    userId: callerUserId,
    filter: scope,
    authorizationScope: scope,
  });
  const found = await executeOne(
    input.database,
    sql`with recursive ${ctes} select count(*)::int count from matched`,
    countRow,
  );
  return found.count;
}

async function assertVisibleInContext(input: ReorderWorkViewInput): Promise<void> {
  const uniqueItemIds = [
    ...new Set([
      input.request.itemId,
      ...(input.request.beforeId === null ? [] : [input.request.beforeId]),
      ...(input.request.afterId === null ? [] : [input.request.afterId]),
    ]),
  ];
  const caller = await executeOne(
    input.database,
    sql`select user_id from actor where id=${input.actorId}
      and organization_id=${input.organizationId} and kind='human'
      and status='active' and archived_at is null`,
    callerRow,
  );
  const idList = sql.join(
    uniqueItemIds.map((itemId) => sql`${itemId}`),
    sql`, `,
  );
  const found =
    input.request.target === 'initiative'
      ? await visibleInitiativeCount(input as InitiativeReorderInput, caller.user_id, idList)
      : await visibleRosterCount(input, caller.user_id, idList);
  if (found !== uniqueItemIds.length) throw new NotFoundError('Work item not found');
}

async function neighborRank(
  database: WorkViewTransaction,
  input: ReorderWorkViewInput,
  itemId: string | null,
): Promise<string | null> {
  if (itemId === null) return null;
  const contextType = input.request.context.kind;
  const id = contextId(input.request.context, input.organizationId);
  const rows = await database
    .select({ rank: workItemOrder.rank })
    .from(workItemOrder)
    .where(
      and(
        eq(workItemOrder.organizationId, input.organizationId),
        eq(workItemOrder.contextType, contextType),
        eq(workItemOrder.contextId, id),
        eq(workItemOrder.target, input.request.target),
        eq(workItemOrder.itemId, itemId),
      ),
    )
    .limit(1);
  return rows[0]?.rank ?? null;
}

const orderRow = z.object({ item_id: z.string(), rank: FractionalRank }).loose();

function allocateRanks(
  lower: string | null,
  upper: string | null,
  count: number,
): z.output<typeof FractionalRank>[] | null {
  if (count === 0) return [];
  let middle: z.output<typeof FractionalRank>;
  try {
    middle = FractionalRank.parse(betweenRanks(lower, upper));
  } catch {
    return null;
  }
  const leftCount = Math.floor(count / 2);
  const rightCount = count - leftCount - 1;
  const left = allocateRanks(lower, middle, leftCount);
  if (!left) return null;
  const right = allocateRanks(middle, upper, rightCount);
  return right ? [...left, middle, ...right] : null;
}

async function boundedOrderRows(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  comparator: '<=' | '>=',
  anchor: string,
  limit: number,
): Promise<z.output<typeof orderRow>[]> {
  const contextType = input.request.context.kind;
  const id = contextId(input.request.context, input.organizationId);
  const comparison = comparator === '<=' ? sql`rank <= ${anchor}` : sql`rank >= ${anchor}`;
  const direction = comparator === '<=' ? sql`desc` : sql`asc`;
  return executeRows(
    tx,
    sql`select item_id, rank from work_item_order
      where organization_id=${input.organizationId} and context_type=${contextType}
        and context_id=${id} and target=${input.request.target} and ${comparison}
      order by rank ${direction}, item_id ${direction} limit ${limit}`,
    orderRow,
  );
}

async function writeRanks(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  rows: readonly { readonly itemId: string; readonly rank: z.output<typeof FractionalRank> }[],
): Promise<void> {
  if (rows.length === 0) return;
  const contextType = input.request.context.kind;
  const id = contextId(input.request.context, input.organizationId);
  await tx
    .insert(workItemOrder)
    .values(
      rows.map((row) => ({
        organizationId: input.organizationId,
        contextType,
        contextId: id,
        target: input.request.target,
        itemId: row.itemId,
        rank: row.rank,
      })),
    )
    .onConflictDoUpdate({
      target: [
        workItemOrder.organizationId,
        workItemOrder.contextType,
        workItemOrder.contextId,
        workItemOrder.target,
        workItemOrder.itemId,
      ],
      set: { rank: sql`excluded.rank`, updatedAt: new Date() },
    });
}

async function rebalanceNeighborhood(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  after: string | null,
  before: string | null,
  halfWindow: number,
): Promise<boolean> {
  const center = after ?? before;
  if (center === null) return false;
  const [descending, ascending] = await Promise.all([
    boundedOrderRows(tx, input, '<=', after ?? center, halfWindow + 1),
    boundedOrderRows(tx, input, '>=', before ?? center, halfWindow + 1),
  ]);
  const lowerBoundary = descending[halfWindow]?.rank ?? null;
  const upperBoundary = ascending[halfWindow]?.rank ?? null;
  const byItem = new Map<string, z.output<typeof orderRow>>();
  for (const row of [...descending.slice(0, halfWindow), ...ascending.slice(0, halfWindow)]) {
    byItem.set(row.item_id, row);
  }
  const window = [...byItem.values()].sort(
    (left, right) =>
      left.rank.localeCompare(right.rank) || left.item_id.localeCompare(right.item_id),
  );
  const ranks = allocateRanks(lowerBoundary, upperBoundary, window.length);
  if (!ranks) return false;
  await writeRanks(
    tx,
    input,
    window.map((row, index) => {
      const rank = ranks[index];
      if (!rank) throw new TypeError('Bounded rank allocation returned too few positions.');
      return { itemId: row.item_id, rank };
    }),
  );
  return true;
}

/** An attempt to place ranks, and the edge a rebalance should widen when it did not fit. */
interface PlacementAttempt {
  readonly success: boolean;
  /** The rank below the gap this attempt needed, or `null` at the head of the list. */
  readonly lower: string | null;
  /** The rank above the gap this attempt needed, or `null` at the tail. */
  readonly upper: string | null;
}

async function materializeMissingNeighbors(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  before: string | null,
  after: string | null,
): Promise<void> {
  const missing = [
    ...(input.request.afterId !== null && after === null ? [input.request.afterId] : []),
    ...(input.request.beforeId !== null && before === null ? [input.request.beforeId] : []),
  ];
  if (missing.length === 0) return;

  const missingItemId = missing[0];
  if (!missingItemId) throw new TypeError('A missing order neighbor had no item id.');
  const place =
    missing.length === 1
      ? () => materializeAdjacent(tx, input, missingItemId)
      : () => appendToTail(tx, input, missing);
  await placeWithRebalance(tx, input, place);
}

/**
 * Run a placement, widening the surrounding gap and retrying while it does not fit.
 *
 * @param tx - The open transaction.
 * @param input - The reorder request.
 * @param place - The placement to attempt.
 * @throws {ApiError} `409` when even the widest rebalance leaves no room.
 */
async function placeWithRebalance(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  place: () => Promise<PlacementAttempt>,
): Promise<void> {
  let attempt = await place();
  if (attempt.success) return;
  for (const halfWindow of REBALANCE_HALF_WINDOWS) {
    if (!(await rebalanceNeighborhood(tx, input, attempt.lower, attempt.upper, halfWindow))) {
      continue;
    }
    attempt = await place();
    if (attempt.success) return;
  }
  throw new ApiError(409, 'conflict', 'The surrounding work order changed; try again');
}

/**
 * Give the one unranked neighbor a rank adjacent to the ranked one.
 *
 * @param tx - The open transaction.
 * @param input - The reorder request.
 * @param missingItemId - The neighbor that has no stored rank.
 * @returns Whether it fit, and the gap it needed.
 */
async function materializeAdjacent(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  missingItemId: string,
): Promise<PlacementAttempt> {
  const [before, after] = await Promise.all([
    neighborRank(tx, input, input.request.beforeId),
    neighborRank(tx, input, input.request.afterId),
  ]);
  const existing = after ?? before;
  const missingAfter = input.request.afterId !== null && after === null;
  const boundary = await executeRows(
    tx,
    adjacentBoundarySql(input, existing, missingAfter),
    orderRow,
  );
  const lower = missingAfter ? (boundary[0]?.rank ?? null) : existing;
  const upper = missingAfter ? existing : (boundary[0]?.rank ?? null);
  const rank = tryRank(lower, upper);
  if (rank === null) return { success: false, lower, upper };
  await writeRanks(tx, input, [{ itemId: missingItemId, rank }]);
  return { success: true, lower, upper };
}

/**
 * The statement that finds the ranked row on the far side of the unranked neighbor.
 *
 * @param input - The reorder request.
 * @param existing - The ranked neighbor's rank, or `null` when neither is ranked.
 * @param missingAfter - Whether the unranked neighbor is the one that sorts lower.
 * @returns The boundary lookup.
 */
function adjacentBoundarySql(
  input: ReorderWorkViewInput,
  existing: string | null,
  missingAfter: boolean,
): SQL {
  const contextType = input.request.context.kind;
  const id = contextId(input.request.context, input.organizationId);
  const scope = sql`organization_id=${input.organizationId} and context_type=${contextType}
    and context_id=${id} and target=${input.request.target}`;
  if (existing === null) {
    const direction = missingAfter ? sql`desc` : sql`asc`;
    return sql`select item_id, rank from work_item_order where ${scope}
      order by rank ${direction}, item_id ${direction} limit 1`;
  }
  return missingAfter
    ? sql`select item_id, rank from work_item_order where ${scope} and rank < ${existing}
        order by rank desc, item_id desc limit 1`
    : sql`select item_id, rank from work_item_order where ${scope} and rank > ${existing}
        order by rank asc, item_id asc limit 1`;
}

/**
 * Give every unranked neighbor a rank past the end of the list.
 *
 * @param tx - The open transaction.
 * @param input - The reorder request.
 * @param missing - The neighbors that have no stored rank.
 * @returns Whether they fit, and the gap the first one that did not needed.
 */
async function appendToTail(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
  missing: readonly string[],
): Promise<PlacementAttempt> {
  const contextType = input.request.context.kind;
  const id = contextId(input.request.context, input.organizationId);
  const tail = await executeRows(
    tx,
    sql`select item_id, rank from work_item_order
      where organization_id=${input.organizationId} and context_type=${contextType}
        and context_id=${id} and target=${input.request.target}
      order by rank desc, item_id desc limit 1`,
    orderRow,
  );
  let lower = tail[0]?.rank ?? null;
  const rows: { itemId: string; rank: z.output<typeof FractionalRank> }[] = [];
  for (const itemId of missing) {
    const candidate = tryRank(lower, null);
    if (candidate === null) return { success: false, lower, upper: null };
    rows.push({ itemId, rank: candidate });
    lower = candidate;
  }
  await writeRanks(tx, input, rows);
  return { success: true, lower, upper: null };
}

/**
 * The rank between two neighbors, when one still fits there.
 *
 * @param lower - The rank to sort after, or `null` at the head.
 * @param upper - The rank to sort before, or `null` at the tail.
 * @returns The rank, or `null` when the gap needs a rebalance first.
 */
function tryRank(
  lower: string | null,
  upper: string | null,
): z.output<typeof FractionalRank> | null {
  try {
    return FractionalRank.parse(betweenRanks(lower, upper));
  } catch {
    return null;
  }
}

async function rankForMove(
  tx: WorkViewTransaction,
  input: ReorderWorkViewInput,
): Promise<z.output<typeof FractionalRank>> {
  const unoccupiedRank = async (
    lower: string | null,
    upper: string | null,
  ): Promise<z.output<typeof FractionalRank> | null> => {
    let candidateLower = lower;
    for (let attempt = 0; attempt < 65; attempt += 1) {
      let candidate: z.output<typeof FractionalRank>;
      try {
        candidate = FractionalRank.parse(betweenRanks(candidateLower, upper));
      } catch {
        return null;
      }
      const occupied = await executeOne(
        tx,
        sql`select count(*)::int count from work_item_order
          where organization_id=${input.organizationId}
            and context_type=${input.request.context.kind}
            and context_id=${contextId(input.request.context, input.organizationId)}
            and target=${input.request.target} and rank=${candidate}
            and item_id<>${input.request.itemId}`,
        countRow,
      );
      if (occupied.count === 0) return candidate;
      candidateLower = candidate;
    }
    return null;
  };
  const readNeighbors = () =>
    Promise.all([
      neighborRank(tx, input, input.request.beforeId),
      neighborRank(tx, input, input.request.afterId),
    ]);
  let [before, after] = await readNeighbors();
  const missing =
    (input.request.beforeId !== null && before === null) ||
    (input.request.afterId !== null && after === null);
  if (missing) {
    await materializeMissingNeighbors(tx, input, before, after);
    [before, after] = await readNeighbors();
  }
  const candidate = await unoccupiedRank(after, before);
  if (candidate) return candidate;

  for (const halfWindow of REBALANCE_HALF_WINDOWS) {
    if (!(await rebalanceNeighborhood(tx, input, after, before, halfWindow))) continue;
    [before, after] = await readNeighbors();
    const retry = await unoccupiedRank(after, before);
    if (retry) return retry;
  }
  throw new ApiError(409, 'conflict', 'The surrounding work order changed; try again');
}

/**
 * Apply a mutable group drop and persist one bounded contextual fractional rank.
 *
 * @param input - Database, authenticated scope, and validated reorder request.
 * @returns The stored rank acknowledgement.
 */
export async function reorderWorkView(
  input: ReorderWorkViewInput,
): Promise<WorkViewOrderResponseValue> {
  if (input.request.target === 'task') {
    const target = await loadTask(input.organizationId, input.request.itemId);
    await assertTaskCapability(input.organizationId, input.actorId, target, 'contribute');
    if (input.request.groupField === 'assignee' || input.request.groupField === 'delegate') {
      await assertTaskCapability(input.organizationId, input.actorId, target, 'assign');
    }
    if (input.request.groupField === 'milestone') {
      await assertMilestoneInOrg(
        input.organizationId,
        nullableStringValue(input.request.groupValue, 'milestone'),
        target.projectId,
      );
    }
  } else if (
    !input.capabilities.some((capability) => satisfies(capability as Capability, 'contribute'))
  ) {
    throw new CapabilityError();
  }
  await assertVisibleInContext(input);
  const committed = await input.database.transaction(async (tx) => {
    const lockKey = [
      input.organizationId,
      input.request.target,
      input.request.context.kind,
      contextId(input.request.context, input.organizationId),
    ].join(':');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const rank = await rankForMove(tx, input);
    const finish = await mutateGroup(tx, input);
    await tx
      .insert(workItemOrder)
      .values({
        organizationId: input.organizationId,
        contextType: input.request.context.kind,
        contextId: contextId(input.request.context, input.organizationId),
        target: input.request.target,
        itemId: input.request.itemId,
        rank,
      })
      .onConflictDoUpdate({
        target: [
          workItemOrder.organizationId,
          workItemOrder.contextType,
          workItemOrder.contextId,
          workItemOrder.target,
          workItemOrder.itemId,
        ],
        set: { rank },
      });
    return { finish, rank };
  });
  await committed.finish();
  return WorkViewOrderResponse.parse({
    target: input.request.target,
    itemId: input.request.itemId,
    rank: committed.rank,
  });
}
