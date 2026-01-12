'use client';

/**
 * Connect calendar button for adding calendar connections.
 * Respects connection limits based on user's subscription tier.
 */

import { useState } from 'react';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import { calendarSyncApi, type CalendarProvider } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { UpgradeModal } from '@/components/ui/upgrade-modal';
import { useEntitlements } from '@/hooks/use-entitlements';
import { CalendarCredentialsDialog } from './calendar-credentials-dialog';

interface ConnectCalendarButtonProps {
  provider: CalendarProvider;
  providerName: string;
  existingAccountCount: number;
  label?: string;
  onConnected?: () => void;
}

/**
 * Button to connect a calendar from a provider.
 * Shows connection count and respects limits based on plan tier.
 *
 * @param props - Connect calendar button props.
 */
export function ConnectCalendarButton({
  provider,
  providerName,
  existingAccountCount,
  label,
  onConnected,
}: ConnectCalendarButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [authState, setAuthState] = useState<string | null>(null);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const { getAccountLimit, hasReachedAccountLimit } = useEntitlements();

  const handleCredentialsOpenChange = (open: boolean) => {
    setCredentialsOpen(open);
    if (!open) {
      setAuthState(null);
    }
  };

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
      if (!result.data.authUrl) {
        return;
      }

      if (result.data.authUrl.startsWith('athena://')) {
        const parsedUrl = new URL(result.data.authUrl);
        const state = parsedUrl.searchParams.get('state');
        if (!state) {
          throw new Error('Missing authorization state.');
        }
        setAuthState(state);
        setCredentialsOpen(true);
      } else {
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
            : (label ?? `Add Another ${providerName} Account`)}
      </Button>

      <UpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        entitlement="integrations"
        featureName="Unlimited Connected Accounts"
        featureDescription={`Free plans are limited to ${accountLimitLabel} connected accounts per provider. Upgrade to Pro for unlimited accounts.`}
      />

      {(provider === 'icloud' || provider === 'caldav') && (
        <CalendarCredentialsDialog
          provider={provider}
          state={authState}
          open={credentialsOpen}
          onOpenChange={handleCredentialsOpenChange}
          onSuccess={onConnected}
        />
      )}
    </>
  );
}
