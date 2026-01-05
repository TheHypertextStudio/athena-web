/**
 * Authentication hooks.
 *
 * @packageDocumentation
 */

'use client';

import { useSession } from '@/lib/auth-client';

/**
 * Hook for accessing authentication state.
 */
export function useAuth() {
  const { data: session, isPending, error } = useSession();

  return {
    user: session?.user ?? null,
    session: session?.session ?? null,
    isLoading: isPending,
    isAuthenticated: !!session?.user,
    error,
  };
}
