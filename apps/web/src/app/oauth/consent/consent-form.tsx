'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { getScopeDescription } from '@/lib/oauth-scopes';
import { CheckCircle, ExternalLink, Shield, XCircle } from 'lucide-react';

interface ConsentFormProps {
  clientId: string;
  clientName?: string;
  clientIcon?: string;
  clientUri?: string;
  scopes: string[];
}

export function ConsentForm({
  clientId,
  clientName,
  clientIcon,
  clientUri,
  scopes,
}: ConsentFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter out OIDC standard scopes for cleaner display
  const displayScopes = scopes.filter((s) => !['openid'].includes(s));

  const handleConsent = async (accept: boolean) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await authClient.oauth2.consent({
        accept,
        scope: scopes.join(' '),
      });

      if (result.error) {
        setError(result.error.message ?? 'Failed to process consent');
        setIsSubmitting(false);
        return;
      }

      // The OAuth provider will redirect automatically after consent
      // If we're still here after a delay, something went wrong
      setTimeout(() => {
        setError('Unexpected response. Please try again.');
        setIsSubmitting(false);
      }, 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Client info */}
      <div className="bg-muted/50 flex items-center gap-3 rounded-lg border p-4">
        {clientIcon ? (
          <Image
            src={clientIcon}
            alt={clientName ?? 'Application'}
            width={48}
            height={48}
            className="rounded-lg"
          />
        ) : (
          <div className="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-lg">
            <Shield className="text-primary h-6 w-6" />
          </div>
        )}
        <div className="flex-1">
          <p className="font-medium">{clientName ?? clientId}</p>
          {clientUri && (
            <a
              href={clientUri}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
            >
              {new URL(clientUri).hostname}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* Permissions list */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium">This application will be able to:</h2>
        <ul className="space-y-2">
          {displayScopes.map((scope) => (
            <li key={scope} className="flex items-start gap-2 text-sm">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
              <span>{getScopeDescription(scope)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Error message */}
      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col gap-3">
        <Button onClick={() => void handleConsent(true)} disabled={isSubmitting} className="w-full">
          {isSubmitting ? 'Processing...' : 'Allow'}
        </Button>
        <Button
          variant="outlined"
          onClick={() => void handleConsent(false)}
          disabled={isSubmitting}
          className="w-full"
        >
          <XCircle className="mr-2 h-4 w-4" />
          Deny
        </Button>
      </div>

      <p className="text-muted-foreground text-center text-xs">
        You can revoke access at any time from your account settings.
      </p>
    </div>
  );
}
