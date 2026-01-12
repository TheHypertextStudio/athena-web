'use client';

/**
 * Add account button for connecting additional accounts from the same provider.
 * Respects account limits based on user's subscription tier.
 */

import { useState } from 'react';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import { calendarSyncApi, type CalendarProvider } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { UpgradeModal } from '@/components/ui/upgrade-modal';
import { useEntitlements } from '@/hooks/use-entitlements';

interface AddAccountButtonProps {
  provider: CalendarProvider;
  providerName: string;
  existingAccountCount: number;
}

/**
 * Button to add another account from the same provider.
 * Shows count of existing accounts and respects account limits based on plan tier.
 */
export function AddAccountButton({
  provider,
  providerName,
  existingAccountCount,
}: AddAccountButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const { getAccountLimit, hasReachedAccountLimit } = useEntitlements();

  const accountLimit = getAccountLimit();
  const isAtLimit = hasReachedAccountLimit(existingAccountCount);
  const accountLimitLabel = accountLimit === null ? 'unlimited' : String(accountLimit);
  const accountCountLabel = String(existingAccountCount);

  const handleClick = async () => {
    if (isAtLimit) {
      setShowUpgradeModal(true);
      return;
    }

    setIsLoading(true);
    try {
      const result = await calendarSyncApi.getAuthUrl(provider);
      if (result.data.authUrl) {
        window.location.href = result.data.authUrl;
      }
    } catch (err) {
      console.error('Failed to get auth URL:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="outlined"
        onClick={() => {
          void handleClick();
        }}
        disabled={isLoading}
        className="w-full"
      >
        <AddOutlinedIcon sx={{ fontSize: 18 }} className="mr-2" />
        {isLoading
          ? 'Redirecting...'
          : isAtLimit
            ? `Account limit reached (${accountCountLabel}/${accountLimitLabel})`
            : `Add Another ${providerName} Account`}
      </Button>

      <UpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        entitlement="integrations"
        featureName="Unlimited Connected Accounts"
        featureDescription={`Free plans are limited to ${accountLimitLabel} connected accounts per provider. Upgrade to Pro for unlimited accounts.`}
      />
    </>
  );
}
