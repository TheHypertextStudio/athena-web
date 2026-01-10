'use client';

import { useTransition } from 'react';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import { Button } from '@/components/ui/button';
import { cancelSubscription, resumeSubscription, createPortalSession } from '@/lib/billing-actions';

interface CurrentPlanActionsProps {
  isPaidPlan: boolean;
  isCanceled: boolean;
}

export function CurrentPlanActions({ isPaidPlan, isCanceled }: CurrentPlanActionsProps) {
  const [isPending, startTransition] = useTransition();

  const handleManageSubscription = () => {
    startTransition(async () => {
      const { portalUrl } = await createPortalSession(window.location.href);
      window.location.href = portalUrl;
    });
  };

  const handleCancel = () => {
    if (
      confirm(
        'Are you sure you want to cancel your subscription? You will retain access until the end of your billing period.',
      )
    ) {
      startTransition(async () => {
        await cancelSubscription();
      });
    }
  };

  const handleResume = () => {
    startTransition(async () => {
      await resumeSubscription();
    });
  };

  return (
    <div className="flex gap-2">
      {isPaidPlan && !isCanceled && (
        <Button variant="outline" onClick={handleCancel} disabled={isPending}>
          Cancel
        </Button>
      )}
      {isCanceled && (
        <Button variant="outline" onClick={handleResume} disabled={isPending}>
          Resume
        </Button>
      )}
      <Button onClick={handleManageSubscription} disabled={isPending}>
        {isPaidPlan ? 'Manage Subscription' : 'Upgrade'}
        <OpenInNewOutlinedIcon sx={{ fontSize: 16 }} className="ml-2" />
      </Button>
    </div>
  );
}
