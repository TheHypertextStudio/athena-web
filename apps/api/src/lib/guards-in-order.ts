/**
 * `@docket/api` — run independent request guards concurrently without reordering their failures.
 */

/**
 * Await every guard at once and re-throw the first failure in the order the guards were written.
 *
 * @param guards - Independent checks, ordered by the precedence their failures should have.
 * @returns Nothing; resolves only when every guard passed.
 * @throws The rejection of the earliest-listed guard that failed.
 *
 * @remarks
 * Validation guards on a create — "does this lead/team/program live in the caller's org?" — are
 * independent reads, so awaiting them one after another turns N round trips into N serial round
 * trips for no reason. Running them concurrently is the obvious fix and the obvious way to do it
 * (`Promise.all`) quietly changes behavior: it rejects with whichever guard *lost the race*, so a
 * request that violates two rules reports a different one from run to run.
 *
 * Settling all of them and then throwing in declaration order keeps failures deterministic and
 * identical to the sequential version, which is what lets this be a pure latency change.
 *
 * @example
 * ```ts
 * await guardsInOrder([
 *   assertRefInOrg(actor, orgId, body.leadId, 'Lead not found'),
 *   assertRefInOrg(team, orgId, body.teamId, 'Team not found'),
 * ]);
 * ```
 */
export async function guardsInOrder(guards: readonly Promise<unknown>[]): Promise<void> {
  const settled = await Promise.allSettled(guards);
  for (const result of settled) {
    if (result.status === 'rejected') throw result.reason;
  }
}
