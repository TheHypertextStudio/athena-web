'use client';

import { useEffect } from 'react';

import { setNavigationSnapshotUser } from '@/lib/navigation-snapshot-runtime';

/** Bind local-first entity snapshots to the resolved account. */
export function NavigationSnapshotPersistence({
  userId,
}: {
  readonly userId: string | null;
}): null {
  useEffect(() => {
    setNavigationSnapshotUser(userId);
    return () => {
      setNavigationSnapshotUser(null);
    };
  }, [userId]);
  return null;
}
