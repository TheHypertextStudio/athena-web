/**
 * Cross-field rules on the Template bodies.
 *
 * @remarks
 * Only the `.refine` predicates are exercised here — the rules that no single field can enforce
 * on its own. Field-level shapes (a non-empty name, a ULID team id) are Zod's job and are not
 * re-asserted.
 */
import { describe, expect, it } from 'vitest';

import { TemplateCreate, TemplateUpdate } from '../../src/contracts/template';

const ACTOR_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const TEAM_ID = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

/** A create body that satisfies both refines, so each test can break exactly one thing. */
function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    targetType: 'task',
    name: 'Bug report',
    payload: { targetType: 'task', title: 'Something is broken' },
    ...overrides,
  };
}

describe('TemplateCreate', () => {
  it('accepts a payload describing the same kind the template creates', () => {
    expect(TemplateCreate.safeParse(createBody()).success).toBe(true);
  });

  it('rejects a payload describing a different kind than the template creates', () => {
    const result = TemplateCreate.safeParse(
      createBody({ targetType: 'project', payload: { targetType: 'task', title: 'Mismatched' } }),
    );

    expect(result.success).toBe(false);
    // The error is reported against the payload's discriminant rather than the template's, because
    // that is the field an author would have to change to reconcile the two.
    expect(
      result.error?.issues.some((issue) => issue.path.join('.') === 'payload.targetType'),
    ).toBe(true);
  });

  it('requires a team-scoped template to name its team', () => {
    const result = TemplateCreate.safeParse(createBody({ scope: 'team' }));

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'teamId')).toBe(true);
  });

  it('accepts a team-scoped template that names its team', () => {
    expect(TemplateCreate.safeParse(createBody({ scope: 'team', teamId: TEAM_ID })).success).toBe(
      true,
    );
  });

  it('does not require a team on a scope that is not team', () => {
    expect(TemplateCreate.safeParse(createBody({ scope: 'personal' })).success).toBe(true);
    expect(
      TemplateCreate.safeParse(createBody({ scope: 'organization', ownerActorId: ACTOR_ID }))
        .success,
    ).toBe(true);
  });
});

describe('TemplateUpdate', () => {
  it('requires the team in the same request that moves scope to team', () => {
    const result = TemplateUpdate.safeParse({ scope: 'team' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'teamId')).toBe(true);
  });

  it('accepts a move to team scope that names the team', () => {
    expect(TemplateUpdate.safeParse({ scope: 'team', teamId: TEAM_ID }).success).toBe(true);
  });

  it('does not require a team when scope moves away from team, or is left alone', () => {
    expect(TemplateUpdate.safeParse({ scope: 'personal' }).success).toBe(true);
    expect(TemplateUpdate.safeParse({ name: 'Renamed' }).success).toBe(true);
  });
});
