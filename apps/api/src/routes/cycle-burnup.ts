import type { CycleBurnupOut } from '@docket/types';
import type { z } from 'zod';

import { committedTasks, computeStats, effort, loadCycle } from './cycle-helpers';

/**
 * Build the burnup payload for a cycle (without the HTTP envelope).
 * The route handler calls `ok(c, CycleBurnupOut, ...)` inline to preserve Hono's RPC types.
 */
export async function buildCycleBurnupPayload(
  orgId: string,
  id: string,
): Promise<z.input<typeof CycleBurnupOut>> {
  const cy = await loadCycle(orgId, id);
  const tasks = await committedTasks(orgId, id);
  const stats = computeStats(cy, tasks);

  // Itemize scope that crept in after the window opened (sorted by when it joined).
  const scopeChanges = tasks
    .filter((t) => t.createdAt.getTime() > cy.startsAt.getTime())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((t) => ({
      taskId: t.id,
      addedAt: t.createdAt.toISOString(),
      estimate: effort(t),
    }));

  // Walk each calendar day of [starts_at, ends_at] inclusive, accruing cumulative planned
  // capacity (rises as scope is added) and cumulative completed effort. `remaining` is the
  // gap between the two — the burn-up's open distance to the plan line.
  const series: z.input<typeof CycleBurnupOut>['series'] = [];
  const dayMs = 86_400_000;
  const start = Date.UTC(
    cy.startsAt.getUTCFullYear(),
    cy.startsAt.getUTCMonth(),
    cy.startsAt.getUTCDate(),
  );
  const end = Date.UTC(cy.endsAt.getUTCFullYear(), cy.endsAt.getUTCMonth(), cy.endsAt.getUTCDate());
  for (let day = start; day <= end; day += dayMs) {
    const dayEnd = day + dayMs;
    let planned = 0;
    let completed = 0;
    for (const t of tasks) {
      if (t.createdAt.getTime() < dayEnd) planned += effort(t);
      if (t.completedAt !== null && t.completedAt.getTime() < dayEnd) completed += effort(t);
    }
    series.push({
      date: new Date(day).toISOString().slice(0, 10),
      planned,
      completed,
      remaining: planned - completed,
    });
  }

  return {
    cycleId: cy.id,
    startsAt: cy.startsAt.toISOString(),
    endsAt: cy.endsAt.toISOString(),
    capacity: stats.capacity,
    series,
    scopeChanges,
    stats,
  };
}
