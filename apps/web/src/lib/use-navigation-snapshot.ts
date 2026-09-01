'use client';

import type { EntityNavigationSnapshot } from './contracts/entity-navigation';
import { useEffect, useState } from 'react';

import {
  peekNavigationSnapshot,
  readNavigationSnapshot,
  subscribeNavigationSnapshots,
} from '@/lib/navigation-snapshot-runtime';

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
    let changed = false;
    const unsubscribe = subscribeNavigationSnapshots(() => {
      changed = true;
      const next = peekNavigationSnapshot(target, id);
      setSnapshot(next?.target === target ? (next as Snapshot) : null);
    });
    void readNavigationSnapshot(target, id).then((persisted) => {
      if (active && !changed && persisted?.target === target) setSnapshot(persisted as Snapshot);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [id, target]);
  return snapshot;
}
