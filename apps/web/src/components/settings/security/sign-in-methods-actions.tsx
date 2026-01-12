'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { authApi } from '@/lib/api-client';
import { linkGoogleAccount, linkAppleAccount, linkMicrosoftAccount } from '@/lib/auth-client';

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

interface UnlinkAccountButtonProps {
  accountId: string;
  providerId: string;
  providerName: string;
  canUnlink: boolean;
}

export function UnlinkAccountButton({
  accountId,
  providerId: _providerId,
  providerName,
  canUnlink,
}: UnlinkAccountButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleUnlink = () => {
    if (!canUnlink) {
      alert('You must keep at least one sign-in method linked to your account.');
      return;
    }
    if (confirm(`Are you sure you want to unlink your ${providerName} account?`)) {
      startTransition(async () => {
        await authApi.unlinkAccount(accountId);
        router.refresh();
      });
    }
  };

  return (
    <Button variant="text" size="sm" onClick={handleUnlink} disabled={isPending || !canUnlink}>
      {isPending ? 'Unlinking...' : 'Unlink'}
    </Button>
  );
}

interface LinkAccountButtonsProps {
  providers: readonly ('google' | 'apple' | 'microsoft')[];
}

export function LinkAccountButtons({ providers }: LinkAccountButtonsProps) {
  const [isLinking, setIsLinking] = useState(false);

  const handleLink = async (provider: 'google' | 'apple' | 'microsoft') => {
    setIsLinking(true);
    try {
      switch (provider) {
        case 'google':
          await linkGoogleAccount();
          break;
        case 'apple':
          await linkAppleAccount();
          break;
        case 'microsoft':
          await linkMicrosoftAccount();
          break;
      }
    } catch (error) {
      console.error('Failed to link account:', error);
      setIsLinking(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {providers.map((provider) => (
        <Button
          key={provider}
          variant="outlined"
          size="sm"
          onClick={() => void handleLink(provider)}
          disabled={isLinking}
        >
          <span className="mr-2 font-medium">{PROVIDER_ICONS[provider]}</span>
          Link {PROVIDER_NAMES[provider]}
        </Button>
      ))}
    </div>
  );
}
