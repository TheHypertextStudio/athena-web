'use client';

import { useState } from 'react';
import ComputerOutlinedIcon from '@mui/icons-material/ComputerOutlined';
import PhoneAndroidOutlinedIcon from '@mui/icons-material/PhoneAndroidOutlined';
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import { useSessions, useLinkedAccounts, useBackupCodes } from '@/hooks/use-security';
import { useSettings } from '@/hooks/use-settings';
import {
  SettingsSection,
  SettingsRow,
  SettingsItemCard,
  SettingsAlertBanner,
  SettingsEmptyState,
} from '@/components/settings/settings-section';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const PROVIDER_NAMES: Record<string, string> = {
  google: 'Google',
  apple: 'Apple',
  microsoft: 'Microsoft',
};

const PROVIDER_ICONS: Record<string, string> = {
  google: 'G',
  apple: '',
  microsoft: 'M',
};

const ALL_PROVIDERS = ['google', 'apple', 'microsoft'] as const;

function getDeviceIcon(userAgent: string | null) {
  if (!userAgent) return PublicOutlinedIcon;
  const ua = userAgent.toLowerCase();
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    return PhoneAndroidOutlinedIcon;
  }
  return ComputerOutlinedIcon;
}

function parseUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';

  const ua = userAgent.toLowerCase();
  let browser = 'Unknown browser';
  let os = 'Unknown OS';

  if (ua.includes('chrome')) browser = 'Chrome';
  else if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('safari')) browser = 'Safari';
  else if (ua.includes('edge')) browser = 'Edge';

  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';

  return `${browser} on ${os}`;
}

export default function SecuritySettingsPage() {
  const {
    sessions,
    isLoading: sessionsLoading,
    revokeSession,
    isRevoking,
    revokeAllSessions,
    isRevokingAll,
  } = useSessions();
  const {
    accounts,
    isLoading: accountsLoading,
    unlinkAccount,
    isUnlinking,
    hasGoogle,
    hasApple,
    hasMicrosoft,
    linkGoogle,
    linkApple,
    linkMicrosoft,
  } = useLinkedAccounts();
  const {
    info: backupInfo,
    isLoading: backupLoading,
    generateCodes,
    isGenerating,
    generatedCodes,
  } = useBackupCodes();
  const { settings, update: updateSettings, isUpdating } = useSettings();
  const [isLinking, setIsLinking] = useState(false);

  const [showBackupCodes, setShowBackupCodes] = useState(false);

  const handleGenerateBackupCodes = async () => {
    await generateCodes();
    setShowBackupCodes(true);
  };

  const handleUnlinkAccount = (accountId: string, providerId: string) => {
    if (accounts.length <= 1) {
      alert('You must keep at least one sign-in method linked to your account.');
      return;
    }
    if (
      confirm(
        `Are you sure you want to unlink your ${PROVIDER_NAMES[providerId] ?? providerId} account?`,
      )
    ) {
      unlinkAccount(accountId);
    }
  };

  const handleLinkAccount = async (provider: 'google' | 'apple' | 'microsoft') => {
    setIsLinking(true);
    try {
      switch (provider) {
        case 'google':
          await linkGoogle();
          break;
        case 'apple':
          await linkApple();
          break;
        case 'microsoft':
          await linkMicrosoft();
          break;
      }
    } catch (error) {
      console.error('Failed to link account:', error);
      setIsLinking(false);
    }
  };

  // Get list of providers that can still be linked
  const unlinkdProviders = ALL_PROVIDERS.filter((provider) =>
    provider === 'google' ? !hasGoogle : provider === 'apple' ? !hasApple : !hasMicrosoft,
  );

  const handleRevokeSession = (sessionId: string) => {
    revokeSession(sessionId);
  };

  const handleRevokeAllSessions = () => {
    revokeAllSessions();
  };

  const handleEncryptionToggle = (enabled: boolean) => {
    updateSettings({ encryptionEnabled: enabled });
  };

  const isLoading = sessionsLoading || accountsLoading || backupLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[150px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sign-in Methods */}
      <SettingsSection title="Sign-in Methods" description="Manage how you sign into your account.">
        <div className="space-y-3">
          {/* Linked accounts */}
          {accounts.length > 0 ? (
            accounts.map((account) => (
              <SettingsItemCard
                key={account.id}
                icon={
                  <span className="text-sm font-medium">
                    {PROVIDER_ICONS[account.providerId] ?? account.providerId[0]?.toUpperCase()}
                  </span>
                }
                title={PROVIDER_NAMES[account.providerId] ?? account.providerId}
                description={`Connected ${new Date(account.createdAt).toLocaleDateString()}`}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      handleUnlinkAccount(account.id, account.providerId);
                    }}
                    disabled={isUnlinking || accounts.length <= 1}
                  >
                    Unlink
                  </Button>
                }
              />
            ))
          ) : (
            <SettingsEmptyState message="No accounts linked." />
          )}

          {/* Link additional accounts */}
          {unlinkdProviders.length > 0 && (
            <div className="border-outline-variant mt-4 border-t pt-4">
              <p className="text-on-surface-variant mb-3 text-sm">Link additional accounts</p>
              <div className="flex flex-wrap gap-2">
                {unlinkdProviders.map((provider) => (
                  <Button
                    key={provider}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void handleLinkAccount(provider);
                    }}
                    disabled={isLinking}
                  >
                    <span className="mr-2 font-medium">{PROVIDER_ICONS[provider]}</span>
                    Link {PROVIDER_NAMES[provider]}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </SettingsSection>

      {/* Active Sessions */}
      <SettingsSection
        title="Active Sessions"
        description="Devices where you're currently signed in."
      >
        <div className="space-y-3">
          {sessions.map((session) => {
            const DeviceIcon = getDeviceIcon(session.userAgent);
            return (
              <SettingsItemCard
                key={session.id}
                icon={<DeviceIcon sx={{ fontSize: 20 }} />}
                title={parseUserAgent(session.userAgent)}
                description={`${session.ipAddress ?? 'Unknown IP'} • Last active ${new Date(session.createdAt).toLocaleDateString()}`}
                badge={session.isCurrent ? <Badge variant="secondary">Current</Badge> : undefined}
                action={
                  !session.isCurrent ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        handleRevokeSession(session.id);
                      }}
                      disabled={isRevoking}
                    >
                      <DeleteOutlinedIcon sx={{ fontSize: 18 }} />
                    </Button>
                  ) : undefined
                }
              />
            );
          })}
          {sessions.length > 1 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Sign out of all other devices
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Sign out everywhere?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will sign you out of all devices except this one. You'll need to sign in
                    again on those devices.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      handleRevokeAllSessions();
                    }}
                    disabled={isRevokingAll}
                  >
                    Sign out everywhere
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </SettingsSection>

      {/* Account Recovery */}
      <SettingsSection title="Account Recovery" description="Backup codes and security settings.">
        <div className="divide-outline-variant divide-y">
          <SettingsRow
            label="Backup Codes"
            description={
              backupInfo?.hasBackupCodes
                ? `${String(backupInfo.remainingCount)} codes remaining`
                : 'Not generated'
            }
          >
            <div className="flex items-center gap-2">
              {backupInfo?.hasBackupCodes && (
                <KeyOutlinedIcon sx={{ fontSize: 16 }} className="text-on-surface-variant" />
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void handleGenerateBackupCodes();
                }}
                disabled={isGenerating}
              >
                {backupInfo?.hasBackupCodes ? 'Regenerate' : 'Generate'}
              </Button>
            </div>
          </SettingsRow>

          <SettingsRow
            label="Encryption at Rest"
            description="Encrypt your data stored on our servers"
          >
            <Switch
              checked={settings?.encryptionEnabled ?? false}
              onCheckedChange={handleEncryptionToggle}
              disabled={isUpdating}
            />
          </SettingsRow>
        </div>

        {/* Show generated backup codes */}
        {showBackupCodes && generatedCodes && (
          <div className="mt-4">
            <SettingsAlertBanner
              icon={<ShieldOutlinedIcon sx={{ fontSize: 20 }} />}
              title="Save your backup codes"
              variant="warning"
            >
              <p className="mb-3">
                Store these codes in a safe place. Each code can only be used once.
              </p>
              <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                {generatedCodes.map((code, i) => (
                  <div
                    key={i}
                    className="bg-surface-container-highest text-on-surface rounded px-2 py-1"
                  >
                    {code}
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setShowBackupCodes(false);
                }}
              >
                I've saved these codes
              </Button>
            </SettingsAlertBanner>
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
