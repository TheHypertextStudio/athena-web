'use client';
import { useState, type JSX } from 'react';
import {
  TemplateTailoringSources,
  type TemplateTailoringSelection,
} from '@docket/work/template-gallery-contract';
import { Button } from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { useApiQuery } from '@/lib/query';
import { useAppSearchParams } from '@/lib/app-location';
import { useAppRouter } from '@/lib/interactions/navigation';
import { UserFacingError } from '@/lib/problem';
import { TemplateSuggestionProgress } from '../template-suggestion-progress';
import { TemplateDisclosure } from '../template-disclosure';
import { TemplateTailoringContextReview } from './template-tailoring-context-review';
import { TemplateTailoringChoices } from './template-tailoring-choices';
import {
  tailoringSourcesDef,
  useTailoringPreview,
  useTailoringRequest,
} from './template-tailoring-queries';

interface PanelProps {
  readonly orgId: string;
  readonly fork: TemplateTailoringSelection['fork'];
}
function useTailoringSetup({ orgId, fork }: PanelProps) {
  const sources = useApiQuery(tailoringSourcesDef(orgId));
  const [selection, setSelection] = useState({
    sessionIds: [] as string[],
    importedTaskIds: [] as string[],
  });
  const [failure, setFailure] = useState<string | null>(null);
  const preview = useTailoringPreview(orgId),
    request = useTailoringRequest(orgId);
  const search = useAppSearchParams(),
    router = useAppRouter();
  const requestId = search.get('tailoring') ?? '';
  const [submitted, setSubmitted] = useState('');
  const id = submitted || (/^[0-9A-HJKMNP-TV-Z]{26}$/.test(requestId) ? requestId : '');
  function change(value: typeof selection): void {
    setSelection(value);
    preview.reset();
    setFailure(null);
  }
  async function review(): Promise<void> {
    setFailure(null);
    try {
      await preview.mutateAsync({ ...selection, fork });
    } catch {
      setFailure('This context could not be reviewed. Check your selection and try again.');
    }
  }
  async function ask(): Promise<void> {
    if (!preview.data) return;
    setFailure(null);
    try {
      const result = await request.mutateAsync({
        ...selection,
        fork,
        fingerprint: preview.data.fingerprint,
      });
      setSubmitted(result.sessionId);
      router.replace(
        `/orgs/${orgId}/work-templates/gallery?fork=${fork}&tailoring=${result.sessionId}`,
        { scroll: false },
      );
    } catch (error) {
      setFailure(
        error instanceof UserFacingError && error.status === 409
          ? 'The saved context changed. Review your selection again.'
          : 'This request could not be started. Try again; the saved request will be reused.',
      );
      preview.reset();
    }
  }
  function chooseContext(): void {
    setSubmitted('');
    preview.reset();
    setFailure(null);
    void sources.refetch();
    router.replace(`/orgs/${orgId}/work-templates/gallery?fork=${fork}`, { scroll: false });
  }
  return { sources, selection, failure, preview, request, id, change, review, ask, chooseContext };
}
/** Optional context review and durable request continuation beside the manual gallery. */
export function TemplateTailoringPanel(props: PanelProps): JSX.Element {
  const state = useTailoringSetup(props);
  return (
    <div className="px-3 sm:px-0">
      <TemplateDisclosure title="Ask Athena to tailor this" defaultOpen={Boolean(state.id)}>
        {state.failure ? (
          <div role="region" aria-label="Review needed" tabIndex={-1} ref={focusReviewFailure}>
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
                onClick={state.chooseContext}
              >
                Choose other context
              </Button>
            </div>
          </>
        ) : (
          <TailoringSetup state={state} />
        )}
      </TemplateDisclosure>
    </div>
  );
}
function TailoringSetup({
  state,
}: {
  readonly state: ReturnType<typeof useTailoringSetup>;
}): JSX.Element {
  const parsed = TemplateTailoringSources.safeParse(state.sources.data);
  if (state.sources.isError)
    return (
      <InlineBanner tone="critical" title="Saved context is unavailable">
        <Button
          variant="ghost"
          onClick={() => {
            void state.sources.refetch();
          }}
        >
          Try again
        </Button>
      </InlineBanner>
    );
  if (!parsed.success)
    return (
      <p role="status" className="text-body-medium">
        Loading saved context…
      </p>
    );
  const preview = state.preview;
  const hasSelection =
    state.selection.sessionIds.length + state.selection.importedTaskIds.length > 0;
  return (
    <>
      {preview.data ? (
        <TemplateTailoringContextReview {...parsed.data} selection={state.selection} />
      ) : (
        <TemplateTailoringChoices
          {...parsed.data}
          selection={state.selection}
          onChange={state.change}
        />
      )}
      {parsed.data.availability === 'available' && hasSelection ? (
        <div className="flex flex-wrap items-center gap-2">
          {preview.data ? (
            <Button
              variant="ghost"
              disabled={state.request.isPending}
              onClick={() => {
                state.change(state.selection);
              }}
            >
              Change selection
            </Button>
          ) : null}
          <Button
            variant="secondary"
            disabled={preview.isPending || state.request.isPending}
            onClick={() => {
              void (preview.data ? state.ask() : state.review());
            }}
          >
            {setupActionLabel(state)}
          </Button>
        </div>
      ) : null}
    </>
  );
}
function setupActionLabel(state: ReturnType<typeof useTailoringSetup>): string {
  if (state.request.isPending) return 'Requesting…';
  if (state.preview.isPending) return 'Reviewing context…';
  return state.preview.data ? 'Ask Athena' : 'Review selected context';
}

function focusReviewFailure(element: HTMLDivElement | null): void {
  element?.focus();
}
