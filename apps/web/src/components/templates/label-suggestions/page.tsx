'use client';
import type { JSX } from 'react';
import { LabelTemplateSuggestionSources } from '@docket/work/template-gallery-contract';
import { Button } from '@docket/ui/primitives';
import { ImmersiveShell, InlineBanner } from '@docket/ui/components';
import { ChevronLeft } from '@docket/ui/icons';
import Link from '@/components/docket-link';
import { useSession } from '@/lib/auth-client';
import { useOptionalActiveOrg } from '@/components/active-org';
import { QueryLoadFailure } from '@/components/feedback';
import { workTemplateHref } from '../work-template-navigation';
import { TemplateSuggestionProgress } from '../template-suggestion-progress';
import { useLabelSuggestion } from './use-suggestion';
import { LabelSuggestionChoices } from './choices';
import { LabelSuggestionReview } from './review';

interface Props {
  readonly orgId: string;
  readonly requestId: string;
}
type State = ReturnType<typeof useLabelSuggestion>;
/** Isolate source selections and request state to the actual person, session and workspace. */
export function LabelSuggestionPage(props: Props): JSX.Element {
  const session = useSession();
  if (!session.data)
    return (
      <p role="status" className="p-3">
        Opening template suggestions…
      </p>
    );
  return (
    <SuggestionWorkspace
      key={JSON.stringify([session.data.user.id, session.data.session.id, props])}
      {...props}
    />
  );
}
function SuggestionWorkspace(props: Props): JSX.Element {
  const state = useLabelSuggestion(props.orgId, props.requestId);
  const workspace = useOptionalActiveOrg()?.orgs.find((org) => org.id === props.orgId);
  return (
    <ImmersiveShell
      header={
        <nav
          aria-label="Template suggestion navigation"
          className="flex min-w-0 items-center justify-between gap-3"
        >
          <Button asChild variant="ghost" className="px-0">
            <Link href={workTemplateHref(props.orgId)}>
              <ChevronLeft aria-hidden="true" className="size-4" />
              Work templates
            </Link>
          </Button>
          <span className="text-body-small text-on-surface-variant min-w-0 truncate">
            {workspace?.name}
          </span>
        </nav>
      }
    >
      <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5 px-3 pb-6 sm:px-6">
        <header className="space-y-2">
          <h1 className="text-headline-small">Suggest a template from labelled work</h1>
          <p className="text-body-medium text-on-surface-variant">
            Choose examples of work you already do. Athena can turn their outline into a reusable
            starting point.
          </p>
        </header>
        {state.failure ? (
          <div role="region" aria-label="Review needed" tabIndex={-1} ref={focusFailure}>
            <InlineBanner tone="critical" title="Review needed">
              {state.failure}
            </InlineBanner>
          </div>
        ) : null}
        {state.id ? (
          <>
            <TemplateSuggestionProgress orgId={props.orgId} id={state.id} />
            <div>
              <Button
                variant="ghost"
                className="h-auto max-w-full py-2 whitespace-normal"
                onClick={state.chooseAgain}
              >
                Choose other examples
              </Button>
            </div>
          </>
        ) : (
          <SuggestionSetup orgId={props.orgId} state={state} />
        )}
        <div>
          <Link
            className="text-body-medium text-primary underline"
            href={workTemplateHref(props.orgId, '/gallery')}
          >
            Browse starting points
          </Link>
        </div>
      </main>
    </ImmersiveShell>
  );
}
function SuggestionSetup({
  orgId,
  state,
}: {
  readonly orgId: string;
  readonly state: State;
}): JSX.Element {
  const parsed = LabelTemplateSuggestionSources.safeParse(state.sources.data);
  if (state.sources.isError)
    return <QueryLoadFailure title="Available labels" query={state.sources} />;
  if (!parsed.success) return <p role="status">Loading your labels…</p>;
  const sources = parsed.data;
  if (sources.availability !== 'available' || !sources.groups.length)
    return <SourceAvailability sources={sources} />;
  if (state.sourceRevoked) return <p role="status">Updating available labels…</p>;
  const busy = state.preview.isPending || state.request.isPending;
  return (
    <>
      {state.preview.data ? (
        <LabelSuggestionReview review={state.preview.data} />
      ) : (
        <LabelSuggestionChoices
          orgId={orgId}
          sources={sources}
          selection={state.selection}
          disabled={busy}
          onChange={state.change}
        />
      )}
      {state.selection.workIds.length ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {state.preview.data ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                state.change(state.selection);
              }}
            >
              Change examples
            </Button>
          ) : null}
          <Button
            disabled={busy}
            onClick={() => void (state.preview.data ? state.ask() : state.review())}
          >
            {actionLabel(state)}
          </Button>
        </div>
      ) : null}
    </>
  );
}
function SourceAvailability({
  sources,
}: {
  readonly sources: LabelTemplateSuggestionSources;
}): JSX.Element {
  if (sources.availability === 'requires_pro')
    return (
      <p className="text-body-medium text-on-surface-variant">
        Athena suggestions are available with Docket Pro. You can browse and copy starting points on
        any plan.
      </p>
    );
  if (sources.availability === 'authoring_unavailable')
    return (
      <p className="text-body-medium text-on-surface-variant">
        Your workspace’s authoring permissions do not currently allow Athena to propose templates
        for you.
      </p>
    );
  return (
    <p className="text-body-medium text-on-surface-variant">
      There are no label groups available here yet. Group the labels you use for kinds of work, then
      return to choose examples.
    </p>
  );
}
function actionLabel(state: State): string {
  if (state.request.isPending) return 'Requesting…';
  if (state.preview.isPending) return 'Reviewing examples…';
  return state.preview.data ? 'Ask Athena' : 'Review selected examples';
}
function focusFailure(element: HTMLDivElement | null): void {
  element?.focus();
}
