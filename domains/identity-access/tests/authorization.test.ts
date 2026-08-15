import { describe, expect, it } from 'vitest';

import { evaluateExplicitAllow } from '@docket/identity-access/authorization';
import {
  grantAppliesToChain,
  matchesGrantPrincipal,
  type ExplicitGrant,
  type GrantPrincipal,
  type GrantResourceChain,
} from '@docket/identity-access/grants';

const NOW = new Date('2026-08-14T12:00:00.000Z');

const principal: GrantPrincipal = {
  organizationId: 'org-1',
  actorId: 'actor-1',
  roleId: 'role-1',
};

const resourceChain: GrantResourceChain = {
  organizationId: 'org-1',
  resources: [
    { kind: 'task', id: 'task-1' },
    { kind: 'project', id: 'project-1' },
    { kind: 'organization', id: 'org-1' },
  ],
};

function grant(overrides: Partial<ExplicitGrant> = {}): ExplicitGrant {
  return {
    organizationId: 'org-1',
    subjectKind: 'actor',
    subjectId: 'actor-1',
    resourceKind: 'task',
    resourceId: 'task-1',
    capabilities: ['view'],
    effect: 'allow',
    cascades: true,
    expiresAt: null,
    ...overrides,
  };
}

describe('explicit grant applicability', () => {
  it('matches actor grants only to the same actor and role grants only to the same role', () => {
    expect(matchesGrantPrincipal(grant(), principal)).toBe(true);
    expect(matchesGrantPrincipal(grant({ subjectId: 'actor-2' }), principal)).toBe(false);
    expect(
      matchesGrantPrincipal(grant({ subjectKind: 'role', subjectId: 'role-1' }), principal),
    ).toBe(true);
    expect(
      matchesGrantPrincipal(grant({ subjectKind: 'role', subjectId: 'role-2' }), principal),
    ).toBe(false);
  });

  it('does not apply a non-cascading ancestor, but does apply an exact target', () => {
    expect(
      grantAppliesToChain(
        grant({ resourceKind: 'project', resourceId: 'project-1', cascades: false }),
        principal,
        resourceChain,
        NOW,
      ),
    ).toBe(false);
    expect(grantAppliesToChain(grant({ cascades: false }), principal, resourceChain, NOW)).toBe(
      true,
    );
  });

  it('requires matching organization facts before a grant can apply', () => {
    expect(
      grantAppliesToChain(grant({ organizationId: 'org-2' }), principal, resourceChain, NOW),
    ).toBe(false);
    expect(
      matchesGrantPrincipal(grant({ subjectKind: 'role', subjectId: 'role-1' }), {
        ...principal,
        roleId: null,
      }),
    ).toBe(false);
  });
});

describe('explicit allow evaluation', () => {
  it('excludes expired grants from the effective capability', () => {
    expect(
      evaluateExplicitAllow({
        grants: [
          grant({ capabilities: ['manage'], expiresAt: new Date('2026-08-14T11:59:59.999Z') }),
        ],
        principal,
        required: 'view',
        resourceChain,
        now: NOW,
      }),
    ).toEqual({ allow: false, effectiveCapability: null, reason: 'no_grant' });
  });

  it('chooses the strongest applicable allow capability and reports a stable reason', () => {
    expect(
      evaluateExplicitAllow({
        grants: [
          grant({ capabilities: ['view'] }),
          grant({ capabilities: ['assign'] }),
          grant({ capabilities: ['manage'], effect: 'deny' }),
          grant({ subjectId: 'actor-2', capabilities: ['manage'] }),
        ],
        principal,
        required: 'contribute',
        resourceChain,
        now: NOW,
      }),
    ).toEqual({ allow: true, effectiveCapability: 'assign', reason: 'allow' });
  });

  it('reports insufficient when an applicable capability falls short', () => {
    expect(
      evaluateExplicitAllow({
        grants: [grant({ capabilities: ['comment'] })],
        principal,
        required: 'contribute',
        resourceChain,
        now: NOW,
      }),
    ).toEqual({ allow: false, effectiveCapability: 'comment', reason: 'insufficient' });
  });
});
