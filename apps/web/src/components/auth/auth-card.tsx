/**
 * Shared auth card layout for consistent styling.
 *
 * @packageDocumentation
 */

import type { ReactNode } from 'react';

interface AuthCardProps {
  children: ReactNode;
}

/**
 * Consistent card wrapper for auth forms.
 */
export function AuthCard({ children }: AuthCardProps) {
  return <div className="w-full space-y-6">{children}</div>;
}
