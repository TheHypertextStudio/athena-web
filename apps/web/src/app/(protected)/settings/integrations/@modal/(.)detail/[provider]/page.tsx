'use client';

/**
 * Intercepted modal route for integration detail.
 *
 * This route is matched when navigating from the integrations list,
 * displaying the detail content in a modal dialog.
 */

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { IntegrationDetailContent } from '@/components/integrations';
import { getIntegrationConfig } from '@/lib/integrations';

export default function IntegrationDetailModalPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const router = useRouter();
  const { provider } = use(params);
  const config = getIntegrationConfig(provider);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      router.back();
    }
  };

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <VisuallyHidden asChild>
          <DialogTitle>{config?.name ?? 'Integration'} Details</DialogTitle>
        </VisuallyHidden>
        <VisuallyHidden asChild>
          <DialogDescription>
            View and manage your {config?.name ?? 'integration'} connection settings.
          </DialogDescription>
        </VisuallyHidden>
        <IntegrationDetailContent provider={provider} />
      </DialogContent>
    </Dialog>
  );
}
