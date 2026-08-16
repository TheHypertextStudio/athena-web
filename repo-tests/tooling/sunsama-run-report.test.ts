/**
 * The committed Sunsama run report upholds the §5.3-closure contract.
 *
 * @remarks
 * `scripts/import-sunsama.ts` counts `persistedByReconciler` from the database after an applied
 * run — that query needs a live database and full org scaffolding, so the counting block itself
 * is exercised by actually running `--apply` (the committed report IS that run's output). What
 * this test can hold still without any scaffolding is the report contract: an applied report
 * carries the persisted counts, they are internally consistent with the per-workspace tallies,
 * and the old `notWrittenByReconciler` field cannot quietly come back. A regeneration that drops
 * or skews the counts goes red here instead of shipping as documentation.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPORT_PATH = fileURLToPath(
  new URL('../../docs/migration/sunsama-run.json', import.meta.url),
);

interface WorkspaceOutcome {
  readonly workspace: string;
  readonly routed: number;
  readonly childRows: number;
  readonly created: number;
  readonly alreadyPresent: number;
}

interface RunReport {
  readonly applied: boolean;
  readonly sunsamaActiveCount: number;
  readonly docketMatchedCount: number;
  readonly unmatchedSunsamaIds: readonly string[];
  readonly unmatchedDocketIds: readonly string[];
  readonly workspaces: readonly WorkspaceOutcome[];
  readonly persistedByReconciler?: {
    readonly startDate: number;
    readonly estimateMinutes: number;
    readonly childRows: number;
  };
}

const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as RunReport & Record<string, unknown>;

describe('docs/migration/sunsama-run.json — the committed applied-run report', () => {
  it('is an applied run carrying the DB-measured persisted counts', () => {
    expect(report.applied).toBe(true);
    expect(report.persistedByReconciler).toBeDefined();
  });

  it('no longer carries notWrittenByReconciler — the §5.3 gap it reported is closed', () => {
    expect(report['notWrittenByReconciler']).toBeUndefined();
  });

  it('persisted child-row count equals the child rows routed across workspaces', () => {
    const routedChildRows = report.workspaces.reduce((sum, w) => sum + w.childRows, 0);
    expect(report.persistedByReconciler?.childRows).toBe(routedChildRows);
  });

  it('every routed row (tasks + child rows) is accounted for as created or already present', () => {
    for (const w of report.workspaces) {
      expect(w.created + w.alreadyPresent).toBe(w.routed + w.childRows);
    }
  });

  it('the reconciliation matched every routed row and left both unmatched lists empty', () => {
    const totalRows = report.workspaces.reduce((sum, w) => sum + w.routed + w.childRows, 0);
    expect(report.docketMatchedCount).toBe(totalRows);
    expect(report.unmatchedSunsamaIds).toEqual([]);
    expect(report.unmatchedDocketIds).toEqual([]);
  });

  it('persisted counts never exceed the rows that exist', () => {
    const totalRows = report.workspaces.reduce((sum, w) => sum + w.routed + w.childRows, 0);
    const persisted = report.persistedByReconciler;
    expect(persisted).toBeDefined();
    if (!persisted) return;
    for (const count of [persisted.startDate, persisted.estimateMinutes, persisted.childRows]) {
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(totalRows);
    }
  });
});
