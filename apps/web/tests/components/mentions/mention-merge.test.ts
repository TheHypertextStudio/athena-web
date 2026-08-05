import type { MentionItem } from '@docket/types';
import { describe, expect, it } from 'vitest';

import {
  buildMentionGroups,
  flattenMentionGroups,
  resolveActiveKey,
  stepActiveKey,
} from '@/components/mentions/mention-merge';

function local(
  id: string,
  entityKind: MentionItem extends never ? never : 'task' | 'actor' = 'task',
): MentionItem {
  return {
    origin: 'local',
    id,
    ref: { kind: 'entity', entityKind, entityId: id },
    entityKind,
    title: id,
    subtitle: null,
    href: `/x/${id}`,
    score: 1,
  };
}

function external(id: string, url = `https://x/${id}`): MentionItem {
  return {
    origin: 'external',
    id,
    ref: { kind: 'external', url },
    provider: 'google_drive',
    resourceType: 'document',
    title: id,
    subtitle: null,
    url,
    iconUrl: null,
    modifiedAt: null,
    score: 1,
  };
}

describe('buildMentionGroups', () => {
  it('always sorts external rows below local ones', () => {
    const groups = buildMentionGroups({
      local: [local('t1')],
      external: [external('f1')],
      hasQuery: true,
    });
    expect(groups.map((g) => g.key)).toEqual(['work', 'files']);
  });

  it('separates people from work', () => {
    const groups = buildMentionGroups({
      local: [local('t1'), local('a1', 'actor')],
      external: [],
      hasQuery: true,
    });
    expect(groups.map((g) => g.key)).toEqual(['work', 'people']);
  });

  it('calls the local group Recent when nothing has been typed', () => {
    const groups = buildMentionGroups({ local: [local('t1')], external: [], hasQuery: false });
    expect(groups[0]?.key).toBe('recent');
    expect(groups[0]?.label).toBe('Recent');
  });

  it('drops the external duplicate when both waves return the same resource', () => {
    const groups = buildMentionGroups({
      local: [external('shared')],
      external: [external('shared')],
      hasQuery: true,
    });
    expect(flattenMentionGroups(groups)).toHaveLength(1);
  });

  it('omits empty groups rather than rendering an empty heading', () => {
    expect(buildMentionGroups({ local: [], external: [], hasQuery: true })).toEqual([]);
  });
});

describe('resolveActiveKey', () => {
  it('tracks the best match while the user is still typing', () => {
    const items = [local('a'), local('b')];
    expect(
      resolveActiveKey({ items, activeKey: 'b', hasArrowed: false, previousItems: items }),
    ).toBe('a');
  });

  it('keeps the chosen row when late external results arrive below it', () => {
    const before = [local('a'), local('b')];
    const after = [local('a'), local('b'), external('f1')];
    expect(
      resolveActiveKey({ items: after, activeKey: 'b', hasArrowed: true, previousItems: before }),
    ).toBe('b');
  });

  it('holds position rather than snapping to the top when the chosen row disappears', () => {
    const before = [local('a'), local('b'), local('c')];
    const after = [local('a'), local('c')];
    expect(
      resolveActiveKey({ items: after, activeKey: 'b', hasArrowed: true, previousItems: before }),
    ).toBe('c');
  });

  it('falls back to the first row when the chosen row was never in the list', () => {
    const items = [local('a')];
    expect(
      resolveActiveKey({ items, activeKey: 'ghost', hasArrowed: true, previousItems: [] }),
    ).toBe('a');
  });

  it('clamps to the last row when the list shrinks past the held position', () => {
    const before = [local('a'), local('b'), local('c')];
    const after = [local('a')];
    expect(
      resolveActiveKey({ items: after, activeKey: 'c', hasArrowed: true, previousItems: before }),
    ).toBe('a');
  });

  it('highlights nothing when there is nothing to highlight', () => {
    expect(
      resolveActiveKey({ items: [], activeKey: 'a', hasArrowed: true, previousItems: [] }),
    ).toBeUndefined();
  });
});

describe('stepActiveKey', () => {
  it('wraps at both ends', () => {
    const items = [local('a'), local('b'), local('c')];
    expect(stepActiveKey(items, 'c', 1)).toBe('a');
    expect(stepActiveKey(items, 'a', -1)).toBe('c');
    expect(stepActiveKey(items, 'a', 1)).toBe('b');
  });

  it('starts from the top when nothing is highlighted yet', () => {
    expect(stepActiveKey([local('a'), local('b')], undefined, 1)).toBe('a');
  });

  it('has nothing to step to in an empty list', () => {
    expect(stepActiveKey([], 'a', 1)).toBeUndefined();
  });
});
