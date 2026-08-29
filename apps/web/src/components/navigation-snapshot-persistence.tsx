'use client';

import { useEffect } from 'react';

import { waitForOutboxSessionTransition } from '@/components/pwa/outbox';
import { setNavigationSnapshotUser } from '@/lib/navigation-snapshot-runtime';

/** Bind local-first entity snapshots to the resolved account. */
export function NavigationSnapshotPersistence({
  userId,
}: {
  readonly userId: string | null;
}): null {
  useEffect(() => {
    let current = true;
    void waitForOutboxSessionTransition().then(() => {
      if (current) setNavigationSnapshotUser(userId);
    });
    return () => {
      current = false;
    };
  }, [userId]);
  return null;
}
