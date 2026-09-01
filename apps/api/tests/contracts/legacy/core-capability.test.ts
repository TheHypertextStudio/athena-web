import { describe, expect, it } from 'vitest';

import {
  Capability as IdentityAccessCapability,
  CAPABILITY_RANK as IDENTITY_ACCESS_CAPABILITY_RANK,
  GrantCapability as IdentityAccessGrantCapability,
  satisfies as identityAccessSatisfies,
} from '@docket/identity-access/capabilities';
import {
  GrantResourceKind as IdentityAccessGrantResourceKind,
  GrantSubjectKind as IdentityAccessGrantSubjectKind,
} from '@docket/identity-access/grants';

import {
  Capability,
  CAPABILITY_RANK,
  GrantCapability,
  satisfies,
} from '@docket/identity-access/capabilities';
import { Health, Visibility } from '@docket/work/capability-contract';
import { Priority } from '@docket/work/task-contract';
import { GrantResourceKind, GrantSubjectKind } from '@docket/identity-access/grants';

describe('domain packages Identity & Access compatibility facade', () => {
  it('re-exports the owned capability and grant-kind runtime vocabulary unchanged', () => {
    expect(Capability).toBe(IdentityAccessCapability);
    expect(GrantCapability).toBe(IdentityAccessGrantCapability);
    expect(CAPABILITY_RANK).toBe(IDENTITY_ACCESS_CAPABILITY_RANK);
    expect(satisfies).toBe(identityAccessSatisfies);
    expect(GrantSubjectKind).toBe(IdentityAccessGrantSubjectKind);
    expect(GrantResourceKind).toBe(IdentityAccessGrantResourceKind);
  });
});

describe('Capability', () => {
  it('accepts every capability literal', () => {
    for (const cap of ['view', 'comment', 'contribute', 'assign', 'manage'] as const) {
      expect(Capability.parse(cap)).toBe(cap);
    }
  });

  it('rejects an unknown capability', () => {
    expect(Capability.safeParse('superuser').success).toBe(false);
  });

  it('GrantCapability is the Capability schema', () => {
    expect(GrantCapability).toBe(Capability);
  });
});

describe('CAPABILITY_RANK', () => {
  it('ascends strictly from view to manage', () => {
    expect(CAPABILITY_RANK.view).toBeLessThan(CAPABILITY_RANK.comment);
    expect(CAPABILITY_RANK.comment).toBeLessThan(CAPABILITY_RANK.contribute);
    expect(CAPABILITY_RANK.contribute).toBeLessThan(CAPABILITY_RANK.assign);
    expect(CAPABILITY_RANK.assign).toBeLessThan(CAPABILITY_RANK.manage);
  });
});

describe('satisfies (rank cascade)', () => {
  it('a higher-or-equal held capability satisfies a requirement', () => {
    expect(satisfies('manage', 'view')).toBe(true);
    expect(satisfies('contribute', 'contribute')).toBe(true);
    expect(satisfies('assign', 'comment')).toBe(true);
  });

  it('a lower held capability does not satisfy a higher requirement', () => {
    expect(satisfies('view', 'comment')).toBe(false);
    expect(satisfies('comment', 'manage')).toBe(false);
    expect(satisfies('contribute', 'assign')).toBe(false);
  });
});

describe('Visibility', () => {
  it('accepts public and private', () => {
    expect(Visibility.parse('public')).toBe('public');
    expect(Visibility.parse('private')).toBe('private');
  });

  it('rejects an unknown visibility', () => {
    expect(Visibility.safeParse('hidden').success).toBe(false);
  });
});

describe('Health', () => {
  it('accepts every health literal', () => {
    for (const h of ['on_track', 'at_risk', 'off_track'] as const) {
      expect(Health.parse(h)).toBe(h);
    }
  });

  it('rejects an unknown health', () => {
    expect(Health.safeParse('unknown').success).toBe(false);
  });
});

describe('Priority', () => {
  it('accepts every priority literal', () => {
    for (const p of ['none', 'urgent', 'high', 'medium', 'low'] as const) {
      expect(Priority.parse(p)).toBe(p);
    }
  });

  it('rejects an unknown priority', () => {
    expect(Priority.safeParse('critical').success).toBe(false);
  });
});
