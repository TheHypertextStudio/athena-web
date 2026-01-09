'use client';

/**
 * Intercepted modal route for integration detail.
 *
 * This route is matched when navigating from the integrations list,
 * displaying the detail content in a modal dialog.
 */

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { IntegrationDetailContent } from '@/components/integrations';

export default function IntegrationDetailModalPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const router = useRouter();
  const { provider } = use(params);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      router.back();
    }
  };

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <IntegrationDetailContent provider={provider} />
      </DialogContent>
    </Dialog>
  );
}
