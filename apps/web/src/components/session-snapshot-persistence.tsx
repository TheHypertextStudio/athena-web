'use client';

import { useEffect } from 'react';

import { waitForOutboxSessionTransition } from '@/components/pwa/outbox';
import { type SessionSnapshot, writeSessionSnapshot } from '@/lib/session-snapshot';

/** Persist one authenticated identity after previous-account browser cleanup releases it. */
export function SessionSnapshotPersistence({
  identity,
}: {
  readonly identity: Omit<SessionSnapshot, 'savedAt'> | null;
}): null {
  const userId = identity?.userId ?? null;
  const name = identity?.name ?? null;
  const email = identity?.email ?? null;
  const image = identity?.image ?? null;

  useEffect(() => {
    if (userId === null || name === null || email === null) return undefined;
    let current = true;
    void waitForOutboxSessionTransition().then(() => {
      if (!current) return;
      writeSessionSnapshot({ userId, name, email, image }, Date.now());
    });
    return () => {
      current = false;
    };
  }, [email, image, name, userId]);

  return null;
}
