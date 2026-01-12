'use client';

import * as React from 'react';
import { createContext, useContext, useState, useCallback } from 'react';
import { UpgradeModal } from '@/components/ui/upgrade-modal';
import type { Entitlement } from '@/hooks/use-entitlements';
import type { ApiError } from '@/lib/api-errors';

interface EntitlementErrorContextValue {
  /**
   * Handle an API error, showing upgrade modal if it's an entitlement error.
   * Returns true if it was an entitlement error (handled), false otherwise.
   */
  handleError: (error: ApiError) => boolean;
  /**
   * Show upgrade modal for a specific entitlement.
   */
  showUpgradeModal: (entitlement: Entitlement, featureName?: string) => void;
}

const EntitlementErrorContext = createContext<EntitlementErrorContextValue | null>(null);

export interface EntitlementErrorProviderProps {
  children: React.ReactNode;
}

/**
 * Provider for global entitlement error handling.
 *
 * Wrap your app with this to automatically show upgrade modals
 * when API calls fail with entitlement errors.
 */
export function EntitlementErrorProvider({ children }: EntitlementErrorProviderProps) {
  const [modalState, setModalState] = useState<{
    open: boolean;
    entitlement: Entitlement;
    featureName?: string;
  }>({
    open: false,
    entitlement: 'integrations',
  });

  const handleError = useCallback((error: ApiError): boolean => {
    if (error.isEntitlementError()) {
      const info = error.entitlementInfo;
      setModalState({
        open: true,
        entitlement: info.requiredEntitlement as Entitlement,
      });
      return true;
    }
    return false;
  }, []);

  const showUpgradeModal = useCallback((entitlement: Entitlement, featureName?: string) => {
    setModalState({
      open: true,
      entitlement,
      featureName,
    });
  }, []);

  const handleModalClose = useCallback((open: boolean) => {
    setModalState((prev) => ({ ...prev, open }));
  }, []);

  return (
    <EntitlementErrorContext.Provider value={{ handleError, showUpgradeModal }}>
      {children}
      <UpgradeModal
        open={modalState.open}
        onOpenChange={handleModalClose}
        entitlement={modalState.entitlement}
        featureName={modalState.featureName}
      />
    </EntitlementErrorContext.Provider>
  );
}

/**
 * Hook for handling entitlement errors globally.
 *
 * @example
 * ```tsx
 * const { handleError } = useEntitlementError();
 *
 * try {
 *   await createIntegration(data);
 * } catch (error) {
 *   if (error instanceof ApiError && handleError(error)) {
 *     return; // Upgrade modal shown, don't show generic error
 *   }
 *   // Handle other errors
 * }
 * ```
 */
export function useEntitlementError() {
  const context = useContext(EntitlementErrorContext);
  if (!context) {
    throw new Error('useEntitlementError must be used within EntitlementErrorProvider');
  }
  return context;
}
