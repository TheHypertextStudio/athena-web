'use client';
import { useSyncExternalStore, type ReactNode, type JSX } from 'react';
import { Button, Skeleton } from '@docket/ui/primitives';
import { ImmersiveShell } from '@docket/ui/components';
import { useQueryClient } from '@tanstack/react-query';
import Link from '@/components/docket-link';
import { useOptionalActiveOrg } from '@/components/active-org';
import { ChevronLeft } from '@docket/ui/icons';
import { workTemplateReturnHref } from './work-template-return-context';
import { workTemplateHref } from './work-template-navigation';
import { QueryLoadFailure } from '@/components/feedback';
import { useSession } from '@/lib/auth-client';
import { useApiQuery } from '@/lib/query';
import { useAppSearchParams } from '@/lib/app-location';
import type { TemplateDefinitionSection } from './use-template-section-navigation';
import { useAppRouter } from '@/lib/interactions/navigation';
import { templateAuthoringHref } from './work-template-authoring-route';
import { WorkTemplateForm } from './work-template-form';
import { workTemplateDef } from './work-template-queries';

export { WorkTemplateForm } from './work-template-form';

const subscribeToHydration = (): (() => void) => () => undefined;

function useAuthoringSessionReady(): boolean {
  // Match the server loading frame even when the client session cache is already populated.
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const session = useSession();
  return hydrated && Boolean(session.data);
}

function templateAuthoringParent(
  orgId: string,
  id: string | null,
  candidate: string | null,
  context?: string | null,
) {
  const href = workTemplateReturnHref(orgId, id, candidate, context);
  return href
    ? { label: 'Back to parent template', href }
    : {
        label: 'Back to Work templates',
        href: `${workTemplateHref(orgId)}${id ? `#work-template-${id}` : ''}`,
      };
}

function compactParentLabel(label: string): string {
  return label === 'Back to parent template' ? 'Parent template' : 'Work templates';
}

function authoringSection(value: string | null): TemplateDefinitionSection | undefined {
  switch (value) {
    case 'purpose':
    case 'work':
    case 'structure':
    case 'review':
      return value;
    default:
      return undefined;
  }
}

function AuthoringBackNavigation({
  parent,
  workspaceName,
}: {
  parent: { href: string; label: string };
  workspaceName?: string | undefined;
}): JSX.Element {
  return (
    <nav
      aria-label="Work templates navigation"
      className="flex min-w-0 items-center justify-between gap-2"
    >
      <Button asChild variant="ghost" className="px-0 sm:px-4">
        <Link navigation="activity" href={parent.href} aria-label={parent.label}>
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span className="sm:hidden">{compactParentLabel(parent.label)}</span>
          <span className="hidden sm:inline">{parent.label}</span>
        </Link>
      </Button>
      {workspaceName ? (
        <p
          className="text-body-small text-on-surface-variant min-w-0 truncate sm:px-3"
          aria-label="Workspace"
        >
          {workspaceName}
        </p>
      ) : null}
    </nav>
  );
}

/** Routed editor for an editable draft and the template's immutable publication history. */
export function WorkTemplateAuthoring({
  orgId,
  id,
}: {
  orgId: string;
  id: string | null;
}): JSX.Element {
  const sessionReady = useAuthoringSessionReady();
  const workspace = useOptionalActiveOrg()?.orgs.find((org) => org.id === orgId);
  const searchParams = useAppSearchParams();
  const requestedSection = searchParams.get('section');
  const parent = templateAuthoringParent(
    orgId,
    id,
    searchParams.get('returnTo'),
    searchParams.get('returnContext'),
  );
  const query = useApiQuery({ ...workTemplateDef(orgId, id ?? ''), enabled: id !== null });
  const router = useAppRouter();
  const loading = !sessionReady || (id !== null && query.isPending);
  const failed = id !== null && query.isError;
  const client = useQueryClient();
  const mode = authoringMode(id, searchParams.get('mode'));
  const header = <AuthoringBackNavigation parent={parent} workspaceName={workspace?.name} />;
  const renderActivity = (content: ReactNode, footer?: ReactNode): JSX.Element => (
    <ImmersiveShell header={header} footer={footer}>
      <div
        data-work-template-authoring=""
        className="mx-auto flex w-full max-w-[760px] min-w-0 flex-col gap-6 px-3 pb-6 sm:px-0 sm:pb-8"
      >
        {content}
      </div>
    </ImmersiveShell>
  );
  if (loading) return renderActivity(<Skeleton className="h-64" />);
  if (failed) return renderActivity(<QueryLoadFailure title="Template" query={query} />);
  return (
    <WorkTemplateForm
      key={id ?? 'new'}
      orgId={orgId}
      initial={query.data ?? null}
      mode={mode}
      initialSection={authoringSection(requestedSection)}
      initialReached={Number(searchParams.get('reached') ?? 0)}
      onCreated={(createdId, section, created, reached) => {
        if (created) client.setQueryData(workTemplateDef(orgId, createdId).queryKey, created);
        const context = new URLSearchParams(searchParams.toString());
        context.set('reached', String(reached ?? 0));
        router.replace(
          templateAuthoringHref(orgId, createdId, section ?? 'purpose', mode, context),
        );
      }}
      onFinish={() => {
        router.replace(parent.href);
      }}
      renderActivity={renderActivity}
      returnContext={searchParams.toString()}
    />
  );
}

function authoringMode(id: string | null, requested: string | null): 'create' | 'edit' {
  return id === null || requested === 'create' ? 'create' : 'edit';
}
