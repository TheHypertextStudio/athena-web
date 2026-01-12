'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { createPortalSession } from '@/lib/billing-actions';

export function PaymentMethodsActions() {
  const [isPending, startTransition] = useTransition();

  const handleManagePaymentMethods = () => {
    startTransition(async () => {
      const { portalUrl } = await createPortalSession(window.location.href);
      window.location.href = portalUrl;
    });
  };

  return (
    <Button variant="outlined" size="sm" onClick={handleManagePaymentMethods} disabled={isPending}>
      Manage payment methods
    </Button>
  );
}
