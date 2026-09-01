/**
 * The rollback planner's refusals — the decisions an operator makes mid-incident.
 *
 * @remarks
 * The gcloud boundary is deliberately outside `planRollback`, so every refusal is provable without
 * a live project. Each case here is a mistake that is easy to make while something is broken.
 */
import { describe, expect, it } from 'vitest';

import { planRollback, type Revision } from '../../scripts/rollback';

/** A revision, defaulting to a healthy one serving nothing. */
function revision(overrides: Partial<Revision> = {}): Revision {
  return {
    name: 'docket-api-00230-abc',
    trafficPercent: 0,
    ready: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('planRollback', () => {
  it('routes all traffic to a healthy earlier revision', () => {
    const plan = planRollback(
      [revision({ name: 'new', trafficPercent: 100 }), revision({ name: 'old' })],
      'old',
      'docket-api',
    );

    expect(plan).toEqual({ kind: 'rollback', service: 'docket-api', to: 'old' });
  });

  it('refuses a revision that does not exist, rather than asking gcloud to find out', () => {
    const plan = planRollback([revision({ name: 'only' })], 'typo', 'docket-api');

    expect(plan.kind).toBe('refused');
    expect(plan).toMatchObject({ reason: expect.stringContaining('typo') });
  });

  it('refuses a revision that never became ready', () => {
    // Rolling into a revision that failed to start replaces one outage with another, and loses the
    // revision that is at least still serving.
    const plan = planRollback(
      [revision({ name: 'broken', ready: false }), revision({ name: 'good', trafficPercent: 100 })],
      'broken',
      'docket-api',
    );

    expect(plan.kind).toBe('refused');
    expect(plan).toMatchObject({ reason: expect.stringContaining('never became ready') });
  });

  it('refuses a no-op, so a mistaken rollback is not reported as a fix', () => {
    const plan = planRollback([revision({ name: 'current', trafficPercent: 100 })], 'current', 'x');

    expect(plan.kind).toBe('refused');
    expect(plan).toMatchObject({ reason: expect.stringContaining('already serves') });
  });
});
