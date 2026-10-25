'use client';

import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys } from '@/lib/query';

/** Read current account passkeys to offer optional enrollment through the typed query layer. */
export function onboardingPasskeysDef() {
  return apiQueryOptions(
    queryKeys.passkeys(),
    () => api.v1.me.passkeys.$get({ query: {} }),
    'Could not check your passkeys.',
  );
}
