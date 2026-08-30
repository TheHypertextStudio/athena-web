'use client';

/** Read the viewer's shell density without writing a fallback before storage has loaded. */
import type { Density } from '@docket/ui/components';
import { useEffect, useState } from 'react';

import { readDensity } from '@/components/app-shell-utils';

/**
 * Read a user's density preference after hydration.
 *
 * The initial value matches the server-safe shell default. The hook never writes storage, so a
 * standalone route cannot overwrite a saved compact or spacious choice before it has read it.
 */
export function usePersistedDensity(userId: string | null): Density {
  const [density, setDensity] = useState<Density>('comfortable');

  useEffect(() => {
    setDensity(readDensity(userId));
  }, [userId]);

  return density;
}
