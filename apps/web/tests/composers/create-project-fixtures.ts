import { OrganizationId, TeamId } from '@docket/identity-access/ids';

import type { TeamOut } from '../../src/lib/contracts/team';

export const ORG_ID = '0RG00000000000000000000001';
export const TEAM_ID = 'TEAM0000000000000000000002';
export const GRACE_ID = 'GRC00000000000000000000003';
export const Q3_ID = 'Q3000000000000000000000004';
export const PROGRAM_ID = 'PR0GRAM0000000000000000005';
export const TARGET_ORG_ID = '0RG00000000000000000000006';
export const TARGET_TEAM_ID = 'TEAM0000000000000000000007';
export const TARGET_ACTOR_ID = 'ADA00000000000000000000008';
export const SECOND_TEAM_ID = 'TEAM0000000000000000000009';
export const TARGET_SECOND_TEAM_ID = 'TEAM0000000000000000000010';
export const TARGET_PROGRAM_ID = 'PR0GRAM0000000000000000011';
export const TARGET_INITIATIVE_ID = 'Q3000000000000000000000012';

export const TEAMS: readonly TeamOut[] = [
  {
    id: TeamId.parse(TEAM_ID),
    organizationId: OrganizationId.parse(ORG_ID),
    name: 'General',
    key: 'GEN',
    summary: null,
    triageEnabled: true,
  },
];

export const MEMBERS = [
  {
    actorId: GRACE_ID,
    organizationId: ORG_ID,
    displayName: 'Grace Hopper',
    avatar: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

export const TARGET_MEMBERS = [
  {
    actorId: TARGET_ACTOR_ID,
    organizationId: TARGET_ORG_ID,
    displayName: 'Target Lead',
    avatar: null,
    status: 'active',
    createdAt: '2026-01-02T00:00:00Z',
  },
];

export const INITIATIVES = [
  {
    id: Q3_ID,
    organizationId: ORG_ID,
    name: 'Q3 Reliability',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

export const TARGET_INITIATIVES = [
  {
    id: TARGET_INITIATIVE_ID,
    organizationId: TARGET_ORG_ID,
    name: 'Delivery initiative',
    status: 'active',
    createdAt: '2026-01-02T00:00:00Z',
  },
];

export const PROGRAMS = [
  {
    id: PROGRAM_ID,
    organizationId: ORG_ID,
    name: 'Platform program',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

export const TARGET_PROGRAMS = [
  {
    id: TARGET_PROGRAM_ID,
    organizationId: TARGET_ORG_ID,
    name: 'Delivery program',
    status: 'active',
    createdAt: '2026-01-02T00:00:00Z',
  },
];

export const TARGET_TEAMS: readonly TeamOut[] = [
  {
    id: TeamId.parse(TARGET_TEAM_ID),
    organizationId: OrganizationId.parse(TARGET_ORG_ID),
    name: 'Delivery',
    key: 'DEL',
    summary: null,
    triageEnabled: true,
  },
  {
    id: TeamId.parse(TARGET_SECOND_TEAM_ID),
    organizationId: OrganizationId.parse(TARGET_ORG_ID),
    name: 'Operations',
    key: 'OPS',
    summary: null,
    triageEnabled: true,
  },
];

export const GLOBAL_PROJECT_TEAMS: readonly TeamOut[] = [
  ...TEAMS,
  {
    id: TeamId.parse(SECOND_TEAM_ID),
    organizationId: OrganizationId.parse(ORG_ID),
    name: 'Platform',
    key: 'PLT',
    summary: null,
    triageEnabled: true,
  },
];
