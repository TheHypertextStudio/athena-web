'use client';
import { useEffect, useState, type JSX } from 'react';
import { Button, Skeleton } from '@docket/ui/primitives';
import { ImmersiveShell, InlineBanner } from '@docket/ui/components';
import { ChevronLeft } from '@docket/ui/icons';
import Link from '@/components/docket-link';
import { useOptionalActiveOrg } from '@/components/active-org';
import { useSession } from '@/lib/auth-client';
import { userErrorMessage } from '@/lib/problem';
import { workTemplateHref } from '../work-template-navigation';
import { SourceCopyFlow } from './source-copy-flow';
import {
  readSourceCopy,
  writeSourceCopy,
  type SourceCopyMemory,
  type SourceCopyOwner,
} from './source-copy-session';

function useSourceCopyMemory(owner: SourceCopyOwner | null, attemptId: string) {
  const identity = JSON.stringify([owner?.userId, owner?.sessionId, attemptId]);
  const [stored, setStored] = useState<{
    identity: string;
    memory: SourceCopyMemory | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    setStored(owner ? { identity, memory: readSourceCopy(owner, attemptId) } : null);
  }, [identity]);
  function change(memory: SourceCopyMemory): boolean {
    if (!owner || memory.id !== attemptId) return false;
    try {
      writeSourceCopy(owner, memory);
      setStored({ identity, memory });
      setError(null);
      return true;
    } catch (failure) {
      setError(userErrorMessage(failure, 'Could not remember these choices. Try again.'));
      return false;
    }
  }
  return {
    memory: stored?.identity === identity ? stored.memory : null,
    pending: !owner || stored?.identity !== identity,
    error,
    change,
  };
}
/** Focused manual copy ownership; private source IDs stay out of the route and definition bodies out of storage. */
export function SourceCopyWorkspace({
  orgId,
  attemptId,
}: {
  readonly orgId: string;
  readonly attemptId: string;
}): JSX.Element {
  const session = useSession();
  const owner = session.data
    ? { userId: session.data.user.id, sessionId: session.data.session.id }
    : null;
  const state = useSourceCopyMemory(owner, attemptId);
  const workspace = useOptionalActiveOrg()?.orgs.find(
    (org) => org.id === (state.memory?.destinationOrgId ?? orgId),
  );
  const exit = sourceCopyExit(orgId, state.memory?.source);
  return (
    <ImmersiveShell
      header={
        <nav
          aria-label="Copy navigation"
          className="flex min-w-0 items-center justify-between gap-2"
        >
          <Button wrapLabel asChild variant="ghost" className="px-0">
            <Link href={exit.href} aria-label={exit.label}>
              <ChevronLeft className="size-4" aria-hidden="true" />
              {exit.shortLabel}
            </Link>
          </Button>
          {workspace ? (
            <p className="text-body-small text-on-surface-variant min-w-0 truncate">
              {workspace.name}
            </p>
          ) : null}
        </nav>
      }
    >
      <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-4 pb-6 sm:px-6">
        {state.error ? (
          <InlineBanner tone="critical" title="Could not remember copy choices">
            {state.error}
          </InlineBanner>
        ) : null}
        {state.pending ? (
          <Skeleton className="h-64" />
        ) : state.memory && owner ? (
          <SourceCopyFlow
            key={JSON.stringify([owner, orgId, attemptId])}
            owner={owner}
            orgId={orgId}
            memory={state.memory}
            onChange={state.change}
          />
        ) : (
          <SourceCopyUnavailable orgId={orgId} />
        )}
      </div>
    </ImmersiveShell>
  );
}
function sourceCopyExit(orgId: string, source?: SourceCopyMemory['source']) {
  if (source)
    return {
      href: `${workTemplateHref(source.organizationId)}/${source.workTypeId}`,
      label: 'Back to saved template',
      shortLabel: 'Template',
    };
  return {
    href: workTemplateHref(orgId),
    label: 'Back to Work templates',
    shortLabel: 'Work templates',
  };
}
function SourceCopyUnavailable({ orgId }: { readonly orgId: string }): JSX.Element {
  return (
    <section className="flex min-w-0 flex-col gap-3 px-3 sm:px-0">
      <h1 className="text-title-large">This copy is not available in this tab</h1>
      <p className="text-body-medium">
        Open a saved template and choose Copy to a workspace to start again.
      </p>
      <Button wrapLabel asChild className="self-start">
        <Link href={workTemplateHref(orgId)}>View work templates</Link>
      </Button>
    </section>
  );
}
