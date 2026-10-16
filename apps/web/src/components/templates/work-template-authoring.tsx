'use client';
import { WorkTemplateArchiveAction } from './work-template-archive-action';
import { useState, useSyncExternalStore, type JSX } from 'react';
import { Button, Skeleton, Badge } from '@docket/ui/primitives';
import { useVocabulary } from '@docket/ui/hooks';
import { ImmersiveShell, InlineBanner } from '@docket/ui/components';
import {
  TemplateDefinitionAction,
  TemplatePublicationConsequence,
} from './template-definition-action';
import { WorkTemplateBlueprintSummary } from './work-template-blueprint-summary';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import Link from '@/components/docket-link';
import { useOptionalActiveOrg } from '@/components/active-org';
import { ChevronLeft } from '@docket/ui/icons';
import { workTemplateReturnHref } from './work-template-return-context';
import { TemplateDisclosure } from './template-disclosure';
import { workTemplateHref } from './work-template-navigation';
import { QueryLoadFailure } from '@/components/feedback';
import { StaticMarkdown } from '@/components/editor/static-markdown';
import { useSession } from '@/lib/auth-client';
import { useApiQuery } from '@/lib/query';
import { useAppSearchParams } from '@/lib/app-location';
import {
  useTemplateSectionNavigation,
  type TemplateDefinitionSection,
} from './use-template-section-navigation';
import { useAppRouter } from '@/lib/interactions/navigation';
import { type WorkTemplateFormState, useWorkTemplateForm } from './use-work-template-form';
import { TemplateDefinitionSections } from './template-definition-sections';
import { workTemplateDef, workTemplateVersionsDef } from './work-template-queries';
import {
  TemplatePublicationReadiness,
  useTemplatePublicationReadiness,
} from './work-template-publication-readiness';

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

function templateAuthoringParent(orgId: string, id: string | null, candidate: string | null) {
  const href = workTemplateReturnHref(orgId, id, candidate);
  return href
    ? { label: 'Back to parent definition', href }
    : {
        label: 'Back to Work templates',
        href: `${workTemplateHref(orgId)}${id ? `#work-template-${id}` : ''}`,
      };
}

function compactParentLabel(label: string): string {
  return label === 'Back to parent definition' ? 'Parent definition' : 'Work templates';
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
  const parent = templateAuthoringParent(orgId, id, searchParams.get('returnTo'));
  const query = useApiQuery({ ...workTemplateDef(orgId, id ?? ''), enabled: id !== null });
  const router = useAppRouter();
  const href = workTemplateHref(orgId);
  const loading = !sessionReady || (id !== null && query.isPending);
  const failed = id !== null && query.isError;
  return (
    <ImmersiveShell
      header={
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
          {workspace ? (
            <p
              className="text-body-small text-on-surface-variant min-w-0 truncate sm:px-3"
              aria-label="Workspace"
            >
              {workspace.name}
            </p>
          ) : null}
        </nav>
      }
    >
      <div
        data-work-template-authoring=""
        className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-4 px-0 pb-6 sm:gap-6 sm:px-6 sm:pb-8"
      >
        {loading ? <Skeleton className="h-64" /> : null}
        {failed ? (
          <QueryLoadFailure title="Template" query={query} />
        ) : loading ? null : (
          <WorkTemplateForm
            key={id ?? 'new'}
            orgId={orgId}
            initial={query.data ?? null}
            initialSection={authoringSection(requestedSection)}
            onCreated={(createdId, section) =>
              router.replace(
                `${href}/${createdId}${section && section !== 'work' ? `?section=${section}` : ''}`,
              )
            }
          />
        )}
      </div>
    </ImmersiveShell>
  );
}

/** Failed writes preserve the editable draft; publication is a separate explicit action. */
export function WorkTemplateForm({
  orgId,
  initial,
  onCreated,
  initialSection,
}: {
  orgId: string;
  initial: WorkTemplateOut | null;
  onCreated: (id: string, section?: TemplateDefinitionSection) => void;
  initialSection?: TemplateDefinitionSection | undefined;
}): JSX.Element {
  const navigation = useTemplateSectionNavigation(initialSection ?? (initial ? 'work' : 'purpose'));
  const form = useWorkTemplateForm(orgId, initial, (createdId) => {
    onCreated(createdId, navigation.section);
  });
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {!form.canEdit ? (
        <p className="text-body-small text-on-surface-variant px-3 sm:px-0">
          You can read this template, but you don’t have permission to edit it.
        </p>
      ) : null}
      {initial?.isBase ? (
        <p className="text-body-small text-on-surface-variant px-3 sm:px-0">
          Every item of this kind can use the blank template. Its name follows your workspace’s
          terminology.
        </p>
      ) : null}
      <TemplateDefinitionSections
        orgId={orgId}
        initial={initial}
        form={form}
        navigation={navigation}
        reviewIntro={<TemplateReviewPublication orgId={orgId} initial={initial} form={form} />}
        header={
          <TemplateAuthoringHeader
            orgId={orgId}
            initial={initial}
            form={form}
            navigation={navigation}
          />
        }
      >
        {initial ? (
          <>
            <TemplatePublishedHistory orgId={orgId} id={initial.id} template={initial} visible />
            <TemplatePublicationActions orgId={orgId} initial={initial} form={form} />
          </>
        ) : (
          <p className="text-body-medium text-on-surface-variant">
            Save a private draft to keep this template. Then publish it when your workspace is ready
            to use it.
          </p>
        )}
      </TemplateDefinitionSections>
    </div>
  );
}

function TemplateAuthoringHeader({
  orgId,
  initial,
  form,
  navigation,
}: {
  orgId: string;
  initial: WorkTemplateOut | null;
  form: WorkTemplateFormState;
  navigation: ReturnType<typeof useTemplateSectionNavigation>;
}): JSX.Element {
  const readiness = useTemplatePublicationReadiness(orgId, form.definition);
  const noun = useVocabulary(form.kind);
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-label-medium text-on-surface-variant sm:text-label-large">
          {noun}
          <span className="hidden sm:inline"> definition</span>
        </p>
        <TemplateDraftHeader initial={initial} form={form} />
      </div>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <TemplateDefinitionIdentity form={form} />
        <TemplateDefinitionAction
          form={form}
          initial={initial}
          section={navigation.section}
          publicationBlocked={readiness.loading || readiness.failed || readiness.pending.length > 0}
          onReview={() => {
            navigation.selectSection('review');
          }}
        />
      </div>
      {form.error ? (
        <InlineBanner tone="critical" title="Template could not be saved">
          {form.error}
        </InlineBanner>
      ) : null}
    </>
  );
}

function TemplateReviewPublication({
  orgId,
  initial,
  form,
}: {
  orgId: string;
  initial: WorkTemplateOut | null;
  form: WorkTemplateFormState;
}): JSX.Element {
  const readiness = useTemplatePublicationReadiness(orgId, form.definition);
  return (
    <section aria-label="Review and publish" className="flex min-w-0 flex-col gap-3">
      <h2 tabIndex={-1} className="text-title-large">
        Review & publish
      </h2>
      <TemplatePublicationReadiness
        orgId={orgId}
        name={form.definition.name}
        parentId={initial?.id}
        readiness={readiness}
      />
      <TemplatePublicationConsequence form={form} initial={initial} section="review" />
    </section>
  );
}

function TemplateDefinitionIdentity({ form }: { form: WorkTemplateFormState }): JSX.Element {
  return (
    <div className="min-w-0">
      <h1 className="text-title-large sm:text-headline-large break-words">
        {form.definition.name.trim() ? form.definition.name : 'Define your work'}
      </h1>
    </div>
  );
}

function TemplateDraftHeader({
  initial,
  form,
}: {
  initial: WorkTemplateOut | null;
  form: WorkTemplateFormState;
}): JSX.Element {
  return (
    <Badge variant="outline" className="self-start">
      {initial?.status === 'archived'
        ? 'Archived template'
        : initial?.status === 'published'
          ? `Published · Version ${initial.latestVersion?.number ?? 1}`
          : form.scope === 'team'
            ? 'Team draft'
            : 'Private draft · Only you'}
    </Badge>
  );
}

function TemplatePublishedHistory({
  orgId,
  id,
  template,
  visible,
}: {
  orgId: string;
  id: string | null;
  template: WorkTemplateOut | undefined;
  visible: boolean;
}): JSX.Element | null {
  if (!visible || id === null || !template?.latestVersion) return null;
  return <TemplateHistory orgId={orgId} id={id} />;
}

function TemplateHistory({ orgId, id }: { orgId: string; id: string }): JSX.Element {
  const query = useApiQuery(workTemplateVersionsDef(orgId, id));
  const [selected, setSelected] = useState<string | null>(null);
  const version = query.data?.items.find((item) => item.id === selected);
  return (
    <TemplateDisclosure title="Published history">
      <p className="text-body-small text-on-surface-variant">
        These snapshots stay unchanged when the next draft is edited.
      </p>
      {query.isError ? (
        <QueryLoadFailure title="Template history" query={query} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {(query.data?.items ?? []).map((item) => (
            <Button
              key={item.id}
              type="button"
              variant="secondary"
              onClick={() => {
                setSelected(item.id);
              }}
            >
              Version {item.number}
            </Button>
          ))}
        </div>
      )}
      {version ? (
        <div className="min-w-0">
          <h3 className="text-title-medium break-words">{version.definition.name}</h3>
          <StaticMarkdown value={version.definition.payload.description ?? ''} />
          <WorkTemplateBlueprintSummary blueprint={version.definition.blueprint} />
        </div>
      ) : null}
    </TemplateDisclosure>
  );
}

function TemplatePublicationActions({
  orgId,
  initial,
  form,
}: {
  orgId: string;
  initial: WorkTemplateOut;
  form: WorkTemplateFormState;
}): JSX.Element | null {
  if (initial.isBase || !form.canEdit || initial.status === 'archived') return null;
  return (
    <TemplateDisclosure title="Manage template">
      <WorkTemplateArchiveAction orgId={orgId} id={initial.id} />
    </TemplateDisclosure>
  );
}
