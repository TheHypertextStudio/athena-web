/**
 * OAuth consent page.
 *
 * Displays requested permissions and allows user to accept or deny.
 *
 * @packageDocumentation
 */

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth-server';
import { ConsentForm } from './consent-form';

export const metadata = {
  title: 'Authorize Application - Athena',
  description: 'Grant permissions to an application',
};

interface ConsentPageProps {
  searchParams: Promise<{
    client_id?: string;
    scope?: string;
    state?: string;
    redirect_uri?: string;
  }>;
}

export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const params = await searchParams;
  const clientId = params.client_id;
  const scopeParam = params.scope;

  if (!clientId) {
    redirect('/sign-in?error=missing_client_id');
  }

  // Get the session to ensure user is authenticated
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    // Redirect to sign-in with the OAuth query preserved
    const returnUrl = `/oauth/consent?${new URLSearchParams(params as Record<string, string>).toString()}`;
    redirect(`/sign-in?returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  // Get client info
  let clientInfo: { name?: string; icon?: string; uri?: string } | null = null;
  try {
    const client = await auth.api.getOAuthClientPublic({
      query: { client_id: clientId },
      headers: await headers(),
    });
    clientInfo = {
      name: typeof client.name === 'string' ? client.name : undefined,
      icon: typeof client.icon === 'string' ? client.icon : undefined,
      uri: typeof client.uri === 'string' ? client.uri : undefined,
    };
  } catch {
    // Client lookup failed, continue with minimal info
  }

  const scopes = scopeParam?.split(' ').filter(Boolean) ?? [];

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center p-4">
      <div className="bg-card w-full space-y-6 rounded-lg border p-6 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Authorize Application</h1>
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">
              {clientInfo?.name ?? 'An application'}
            </span>{' '}
            is requesting access to your Athena account.
          </p>
        </div>

        <ConsentForm
          clientId={clientId}
          clientName={clientInfo?.name}
          clientIcon={clientInfo?.icon}
          clientUri={clientInfo?.uri}
          scopes={scopes}
        />
      </div>
    </div>
  );
}
