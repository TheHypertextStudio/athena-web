import { describe, expect, expectTypeOf, it } from 'vitest';

const expectedGroups = [
  ['start', 'Start', ['Config', 'Authentication']],
  [
    'workspaces-and-access',
    'Workspaces and access',
    ['Orgs', 'Members', 'Roles', 'Grants', 'Teams', 'Statuses'],
  ],
  [
    'work',
    'Work',
    [
      'Initiatives',
      'Programs',
      'Projects',
      'Milestones',
      'Cycles',
      'Tasks',
      'Labels',
      'Comments',
      'Updates',
      'Templates',
      'Processes',
      'Recurrence',
      'Capture',
    ],
  ],
  [
    'find-and-present',
    'Find and present',
    ['Search', 'Mentions', 'Views', 'Display', 'Activity', 'Stream', 'Publishing', 'Objects'],
  ],
  [
    'personal-planning',
    'Personal planning',
    ['Hub', 'Calendar', 'Scheduling', 'Agenda', 'Directive', 'DailyPlan', 'Time', 'Work location'],
  ],
  ['athena-and-agents', 'Athena and agents', ['Athena', 'Agents', 'Automations', 'Suggestions']],
  ['connections', 'Connections', ['Integrations']],
  ['account', 'Account', ['Me', 'Notifications', 'Billing']],
] as const;

const consolidations = [
  ['Organizations', 'Orgs'],
  ['Me Notifications', 'Notifications'],
  ['Me Notification Preferences', 'Notifications'],
  ['Me Contact Points', 'Me'],
  ['Me Phone', 'Me'],
  ['Athena Voice', 'Athena'],
  ['OAuth', 'Authentication'],
] as const;

describe('public API tag navigation', () => {
  it('publishes the approved eight groups in their fixed navigation order', async () => {
    const registry = await import('../../src/lib/public-api-tags');
    expect(
      registry.PUBLIC_TAG_GROUPS.map((group) => [group.id, group.displayName, group.tags]),
    ).toEqual(expectedGroups);
  });

  it('assigns every public tag to one group with complete display metadata', async () => {
    const registry = await import('../../src/lib/public-api-tags');
    const membership = registry.PUBLIC_TAG_GROUPS.flatMap((group) => group.tags);
    expect(new Set(membership).size).toBe(membership.length);
    expect(registry.PUBLIC_TAGS.map((tag) => tag.id)).toEqual(membership);
    expect(registry.PUBLIC_TAG_GROUPS.map((group) => group.order)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    for (const [order, tag] of registry.PUBLIC_TAGS.entries()) {
      expect(registry.PUBLIC_TAG_REGISTRY[tag.id]).toEqual(tag);
      expect(tag.order).toBe(order);
      expect(tag.audience).toBe('public');
      expect(tag.displayName.length).toBeGreaterThan(0);
      expect(tag.description.trim()).not.toBe('');
      expect(registry.PUBLIC_TAG_GROUPS.find((group) => group.id === tag.group)?.tags).toContain(
        tag.id,
      );
    }
  });

  it('keeps stable wire tags separate from expanded display labels', async () => {
    const { PUBLIC_TAG_REGISTRY } = await import('../../src/lib/public-api-tags');
    expect(PUBLIC_TAG_REGISTRY.Orgs.displayName).toBe('Organizations (workspaces)');
    expect(PUBLIC_TAG_REGISTRY.DailyPlan.displayName).toBe('Daily plan');
    expect(PUBLIC_TAG_REGISTRY['Work location'].displayName).toBe('Work locations');
    expect(PUBLIC_TAG_REGISTRY.Objects.displayName).toBe('Object commands');
  });

  it.each(consolidations)('consolidates the legacy %s tag into %s', async (legacy, current) => {
    const { resolvePublicTagId } = await import('../../src/lib/public-api-tags');
    expect(resolvePublicTagId(legacy)).toBe(current);
    expect(resolvePublicTagId(current)).toBe(current);
  });

  it.each([
    'Admin',
    'Admin Notifications',
    'Notification Intents',
    'constructor',
    '__proto__',
    'unknown',
  ])('rejects non-public tag %s', async (tag) => {
    const { resolvePublicTagId } = await import('../../src/lib/public-api-tags');
    expect(resolvePublicTagId(tag)).toBeUndefined();
  });
});

describe('public API tag deep links', () => {
  it('retains each redirect target in its public type', async () => {
    const { PUBLIC_TAG_HASH_REDIRECTS, publicTagHash } =
      await import('../../src/lib/public-api-tag-redirects');
    expectTypeOf(PUBLIC_TAG_HASH_REDIRECTS['#tag/oauth']).toEqualTypeOf<'#tag/authentication'>();
    expectTypeOf(PUBLIC_TAG_HASH_REDIRECTS['#tag/organizations']).toEqualTypeOf<'#tag/orgs'>();
    expectTypeOf(publicTagHash('DailyPlan')).toEqualTypeOf<'#tag/dailyplan'>();
  });

  it.each([
    ['#tag/organizations', '#tag/orgs'],
    ['#tag/athena-voice', '#tag/athena'],
    ['#tag/me-notifications', '#tag/notifications'],
    ['#tag/me-notification-preferences', '#tag/notifications'],
    ['#tag/me-contact-points', '#tag/me'],
    ['#tag/me-phone', '#tag/me'],
    ['#tag/oauth', '#tag/authentication'],
  ])('redirects %s to %s without losing the operation suffix', async (legacy, current) => {
    const { redirectPublicTagHash } = await import('../../src/lib/public-api-tag-redirects');
    expect(redirectPublicTagHash(legacy)).toBe(current);
    expect(redirectPublicTagHash(`${legacy}/GET/example`)).toBe(`${current}/GET/example`);
  });

  it.each([
    ['#tag/Organizations', '#tag/orgs'],
    ['#tag/Athena%20Voice/GET/example', '#tag/athena/GET/example'],
    ['#tag/me%20notification%20preferences', '#tag/notifications'],
    ['#tag/Me%20Contact%20Points', '#tag/me'],
  ])('redirects encoded or case-preserving legacy hash %s', async (legacy, current) => {
    const { redirectPublicTagHash } = await import('../../src/lib/public-api-tag-redirects');
    expect(redirectPublicTagHash(legacy)).toBe(current);
  });

  it('creates stable hashes from IDs instead of display labels', async () => {
    const { publicTagHash } = await import('../../src/lib/public-api-tag-redirects');
    expect(publicTagHash('Orgs')).toBe('#tag/orgs');
    expect(publicTagHash('DailyPlan')).toBe('#tag/dailyplan');
    expect(publicTagHash('Work location')).toBe('#tag/work-location');
    expect(publicTagHash('Objects')).toBe('#tag/objects');
  });

  it.each([
    '',
    '#tag/tasks',
    '#tag/organizations-other',
    '#tag/admin',
    '#operation/getTask',
    'https://example.test/#tag/oauth',
  ])('preserves an unrelated hash %s', async (hash) => {
    const { redirectPublicTagHash } = await import('../../src/lib/public-api-tag-redirects');
    expect(redirectPublicTagHash(hash)).toBe(hash);
  });
});
