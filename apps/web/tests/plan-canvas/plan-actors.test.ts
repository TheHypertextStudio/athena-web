import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { usePlanActorResolver } from '../../src/components/plan-canvas/plan-actors';

const MEMBERS = [
  { actorId: 'a1', displayName: 'Priya Natarajan', avatar: 'https://cdn.example/priya.png' },
  { actorId: 'a2', displayName: 'Sam Rivera', avatar: null },
];

describe('usePlanActorResolver', () => {
  it('resolves a member to a person with their avatar and leaves unknown ids null', () => {
    const { result } = renderHook(() => usePlanActorResolver(MEMBERS));
    expect(result.current('a1')).toEqual({
      kind: 'human',
      name: 'Priya Natarajan',
      avatarUrl: 'https://cdn.example/priya.png',
    });
    expect(result.current('a2')).toEqual({ kind: 'human', name: 'Sam Rivera', avatarUrl: null });
    expect(result.current('nobody')).toBeNull();
  });

  it('resolves nothing while the members are still loading', () => {
    const { result } = renderHook(() => usePlanActorResolver(undefined));
    expect(result.current('a1')).toBeNull();
  });
});
