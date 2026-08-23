'use client';

import type { EntityNavigationSnapshot } from '@docket/types';
import { useEffect, useState } from 'react';

import { peekNavigationSnapshot, readNavigationSnapshot } from '@/lib/navigation-snapshot-runtime';

/** Return a target-correlated snapshot from memory immediately or IndexedDB after mount. */
export function useNavigationSnapshot<TTarget extends EntityNavigationSnapshot['target']>(
  target: TTarget,
  id: string,
): Extract<EntityNavigationSnapshot, { target: TTarget }> | null {
  type Snapshot = Extract<EntityNavigationSnapshot, { target: TTarget }>;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => {
    const live = peekNavigationSnapshot(target, id);
    return live?.target === target ? (live as Snapshot) : null;
  });
  useEffect(() => {
    const live = peekNavigationSnapshot(target, id);
    setSnapshot(live?.target === target ? (live as Snapshot) : null);
    let active = true;
    void readNavigationSnapshot(target, id).then((persisted) => {
      if (active && persisted?.target === target) setSnapshot(persisted as Snapshot);
    });
    return () => {
      active = false;
    };
  }, [id, target]);
  return snapshot;
}
