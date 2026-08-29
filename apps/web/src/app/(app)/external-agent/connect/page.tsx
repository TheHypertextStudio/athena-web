'use client';

import { oauthScopesForConnector } from '@docket/types';
import { Button } from '@docket/ui/primitives';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

import Link from '@/components/docket-link';
import { api } from '@/lib/api';
import { useAppSearchParams } from '@/lib/app-location';
import { authClient } from '@/lib/auth-client';
import { UserFacingError, userErrorMessage } from '@/lib/problem';
import { unwrap, useApiMutation } from '@/lib/query';

/** Complete the account-link continuation for an Athena session opened outside Docket. */
export default function ExternalAgentConnectPage(): JSX.Element {
  const searchParams = useAppSearchParams();
  const token = searchParams.get('token');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const complete = useApiMutation({
    mutationFn: (continuation: string) =>
      unwrap(
        () =>
          api.v1.me.identities['external-agent-links'].$post({
            json: { token: continuation },
          }),
        'Could not continue Athena from this link.',
      ),
  });
  const completeNow = complete.mutate;

  useEffect(() => {
    if (token) completeNow(token);
  }, [completeNow, token]);

  if (!token) {
    return (
      <ContinuationFrame title="This link is invalid" body="Open the latest link from Linear." />
    );
  }
  if (complete.isIdle || complete.isPending) {
    return (
      <ContinuationFrame
        title="Connecting your Linear account"
        body="Docket is checking the signed Athena session link."
      />
    );
  }
  if (complete.isSuccess) {
    return (
      <ContinuationFrame
        title="Athena is continuing in Linear"
        body="Your Linear identity is linked, and the waiting Athena session has resumed."
      >
        <Button asChild>
          <Link href="/today">Open Docket</Link>
        </Button>
      </ContinuationFrame>
    );
  }
  const needsLinearIdentity =
    complete.error instanceof UserFacingError &&
    complete.error.code === 'external_identity_mismatch';
  if (needsLinearIdentity) {
    return (
      <ContinuationFrame
        title="Connect the Linear account that opened this session"
        body="Docket must verify the same Linear identity before Athena can continue."
      >
        <Button
          disabled={linking}
          onClick={() => {
            setLinking(true);
            setLinkError(null);
            void authClient
              .linkSocial({
                provider: 'linear',
                scopes: [...oauthScopesForConnector('linear')],
                callbackURL: `/external-agent/connect?${new URLSearchParams({ token }).toString()}`,
              })
              .catch((error: unknown) => {
                setLinkError(userErrorMessage(error, 'Could not start Linear account linking.'));
                setLinking(false);
              });
          }}
        >
          {linking ? 'Opening Linear…' : 'Connect Linear account'}
        </Button>
        {linkError ? (
          <p role="alert" className="text-error text-body-medium">
            {linkError}
          </p>
        ) : null}
      </ContinuationFrame>
    );
  }
  return (
    <ContinuationFrame
      title="Athena could not continue"
      body="Docket could not validate this session link. Open the latest account-link request from Linear and try again."
    >
      <Button
        onClick={() => {
          complete.mutate(token);
        }}
      >
        Try again
      </Button>
    </ContinuationFrame>
  );
}

/** Shared layout for the short authenticated account-link ceremony. */
function ContinuationFrame({
  title,
  body,
  children,
}: {
  readonly title: string;
  readonly body: string;
  readonly children?: ReactNode;
}): JSX.Element {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-2" aria-live="polite">
        <h1 className="text-on-surface text-headline-small">{title}</h1>
        <p className="text-on-surface-variant text-body-large">{body}</p>
      </div>
      {children ? <div className="flex flex-col items-start gap-3">{children}</div> : null}
    </main>
  );
}
