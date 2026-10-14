'use client';

import type { AttachmentOut } from '@docket/work/attachment-contract';
import type { Health } from '@docket/work/capability-contract';
import type { UpdateOut } from '@docket/work/update-contract';
import type { InitiativeConnectedWork } from '@docket/work/initiative-contract';
import { InitiativeSubjectRef } from '@docket/work/subject-ref-contract';
import { useVocabulary } from '@docket/ui/hooks';
import { CornerDownLeft, Ellipsis, Trash2 } from '@docket/ui/icons';
import {
  Button,
  ControlGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
} from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import Link from '@/components/docket-link';
import { useTypedRoute } from '@/lib/app-location';
import { type JSX, useEffect, useMemo, useState } from 'react';

import { ConfirmDestructiveDialog, type PickerOption } from '@docket/ui/components';
import { TemplateAwareEntityDocument } from '@/components/editor/apply-description-template';
import { PartialLoadBanner, QueryLoadFailure } from '@/components/feedback';
import { PlanWithAthenaAction } from '@/components/initiatives/plan-with-athena-action';
import { EditableSubtitle } from '@/components/editor/editable-subtitle';
import { EditableTitle } from '@/components/editor/editable-title';
import { DetailUnavailable } from '@/components/entity-detail/detail-unavailable';
import { ResourcesTab } from '@/components/entity-detail/resources-tab';
import { useEntityMentions } from '@/lib/use-entity-mentions';
import { UpdatesPanel } from '@/components/entity-detail/updates-panel';
import { EntityIconPicker } from '@/components/entity-display/entity-icon-picker';
import { useEntityDisplay } from '@/components/entity-display/use-entity-display';
import { LatestUpdateSummary } from '@/components/entity-detail/latest-update-summary';
import { useWorkStatus } from '@/components/entity-display/use-work-status';
import { InitiativeWorkSummary } from '@/components/initiatives/initiative-work-summary';
import { InitiativeRelationshipPanels } from '@/components/initiatives/initiative-relationship-panels';
import { useConnectedWorkActions } from '@/lib/use-connected-work-actions';
import { initiativePrintProperties } from '@/components/initiatives/initiative-print-properties';
import { InitiativeMastheadMetadata } from '@/components/initiatives/initiative-masthead-metadata';

import { memberActorOptions } from '@/components/pickers/options';
import { usePickerOverlay } from '@/components/pickers/picker-overlay';
import { PublishAction } from '@/components/publishing/publish-action';
import { ContainerDetailLoading } from '@/components/views/entity-snapshot-metadata';
import { DetailPrintSummary } from '@/components/views/detail-print-summary';
import { useDetailTab } from '@/components/views/use-detail-tab';
import { EntityDetailLayout } from '@/components/views/entity-detail-layout';
import { api } from '@/lib/api';
import { useInitiativePageIdentity } from './use-initiative-page-identity';
import {
  aggregateLoadState,
  initiativeDetailAggregateDef,
  terminalDetailFailure,
} from '@/lib/detail-aggregate';
import { initiativeRelationshipSectionsDef } from '@/lib/fetch-initiative-sections';
import {
  apiQueryOptions,
  queryKeys,
  useApiListQuery,
  useApiMutation,
  useApiQuery,
  unwrap,
} from '@/lib/query';
import { labelsDef, useCreateLabel } from '@/components/labels/queries';
import { useInitiativeMutations } from '@/lib/use-initiative-mutations';
import { useFiscalYearStartMonth } from '@/lib/use-fiscal-year-start-month';
import { useNavigationSnapshot } from '@/lib/use-navigation-snapshot';
import { useAppRouter } from '@/lib/interactions/navigation';
import {
  removeNavigationSnapshot,
  seedNavigationSnapshot,
} from '@/lib/navigation-snapshot-runtime';
import { orgMembersDef } from '@/lib/use-org-membership';
import * as orgPages from '@/lib/org-collection-pages';

type TabId = 'overview' | 'subinitiatives' | 'work' | 'updates' | 'resources';
const INITIATIVE_TABS = ['overview', 'subinitiatives', 'work', 'updates', 'resources'] as const;

/** The tabs that read the deferred relationship sections. */
const RELATIONSHIP_TABS: readonly TabId[] = ['overview', 'subinitiatives', 'work'];

/** A stable empty list, so the connected-work memos do not rebuild on every render. */
const NO_CONNECTED_WORK: readonly InitiativeConnectedWork[] = [];

/** How this page names the person behind an update. */
interface ResolvedActor {
  readonly name: string;
  readonly kind: 'human';
}

/** One actor named by the roster, falling back to the Initiative's owner and then to Unknown. */
function resolveInitiativeActor(
  members: readonly { readonly actorId: string; readonly displayName: string }[],
  owner: { readonly actorId: string; readonly displayName: string } | null,
  actorId: string | null | undefined,
): ResolvedActor {
  const member = members.find((item) => item.actorId === actorId);
  if (member) return { name: member.displayName, kind: 'human' };
  if (owner !== null && owner.actorId === actorId) {
    return { name: owner.displayName, kind: 'human' };
  }
  return { name: 'Unknown', kind: 'human' };
}

/** Printable, document-first Initiative detail composed from the shared entity-detail shell. */
export default function InitiativeDetailPage(): JSX.Element {
  const { params } = useTypedRoute('/orgs/[orgId]/initiatives/[initiativeId]');
  const { orgId, initiativeId } = params;
  const subject = InitiativeSubjectRef.parse({
    subjectType: 'initiative',
    subjectId: initiativeId,
  });
  const navigationSnapshot = useNavigationSnapshot('initiative', initiativeId);
  const router = useAppRouter();
  const queryClient = useQueryClient();
  const pickerOverlay = usePickerOverlay();
  const { tab, setTab } = useDetailTab<TabId>(INITIATIVE_TABS);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const [labelsPickerOpen, setLabelsPickerOpen] = useState(false);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const initiativeNoun = useVocabulary('initiative');
  const refreshTitle = `Could not refresh this ${initiativeNoun.toLowerCase()}`;
  const initiativePlural = useVocabulary('initiative', { plural: true });
  const programNoun = useVocabulary('program');
  const projectNoun = useVocabulary('project');
  const aggregateDef = initiativeDetailAggregateDef(orgId, initiativeId);
  const aggregateKey = aggregateDef.queryKey;
  const [aggregateEnabled, setAggregateEnabled] = useState(true);
  const [terminalState, setTerminalState] = useState<'forbidden' | 'not-found' | null>(null);
  const aggregateQ = useApiQuery({ ...aggregateDef, enabled: aggregateEnabled });
  const terminalFailure = terminalDetailFailure(aggregateQ.error);
  const aggregate = aggregateQ.data ?? null;
  const initiativeOwner = aggregate?.references.owner ?? null;
  const entityDisplay = useEntityDisplay({
    organizationId: orgId,
    subjectType: 'initiative',
    subjectId: initiativeId,
    errorMessage: `Could not customize this ${initiativeNoun.toLowerCase()}.`,
    enabled: aggregate !== null,
  });
  const detail = aggregate?.defaultView.initiative ?? null;
  const aggregateState = aggregateLoadState(
    aggregateQ.data,
    aggregateQ.isPending,
    aggregateQ.isError,
  );
  // Overview joins the two relationship tabs here so the projects section can name the work rather
  // than count it. The read stays deferred — the masthead and document come from the aggregate —
  // and it is the same request either relationship tab already fires.
  const relationshipsQ = useApiQuery({
    ...initiativeRelationshipSectionsDef(orgId, initiativeId),
    enabled: aggregate !== null && RELATIONSHIP_TABS.includes(tab),
  });
  const relationships = relationshipsQ.data ?? null;
  const connectedWork = relationships?.connectedWork ?? NO_CONNECTED_WORK;
  const isRelationshipTab = tab === 'subinitiatives' || tab === 'work';
  const entityMentions = useEntityMentions(
    orgId,
    subject,
    aggregate !== null && tab === 'resources',
  );
  const planningCalendar = useFiscalYearStartMonth(orgId, targetPickerOpen);
  const membersQ = useApiQuery({ ...orgMembersDef(orgId), enabled: ownerPickerOpen });
  const members = membersQ.data?.items ?? [];
  const selectedLabelsQ = useApiQuery(
    apiQueryOptions(
      [...aggregateKey, 'labels'],
      () => orgPages.fetchAllInitiativeLabels(api, orgId, initiativeId),
      'Could not load Initiative labels.',
      { enabled: labelsPickerOpen },
    ),
  );
  const labelsQ = useApiListQuery({ ...labelsDef(orgId), enabled: labelsPickerOpen });
  const resourcesKey = [...aggregateKey, 'resources'] as const;
  const resourcesQ = useApiQuery(
    apiQueryOptions(
      resourcesKey,
      () => orgPages.fetchAllInitiativeResources(api, orgId, initiativeId),
      'Could not load resources.',
      { enabled: aggregate !== null && tab === 'resources' },
    ),
  );
  const updatesKey = [...aggregateKey, 'updates'] as const;
  const updatesEnabled = aggregate !== null && (tab === 'overview' || tab === 'updates');
  const updatesQ = useApiQuery(
    apiQueryOptions(
      updatesKey,
      () =>
        api.v1.orgs[':orgId'].updates.$get({
          param: { orgId },
          query: subject,
        }),
      'Could not load updates.',
      { enabled: updatesEnabled },
    ),
  );
  const updates = updatesQ.data?.items ?? [];
  // A disabled query reports `isPending` forever, and the Overview panel stays mounted behind
  // `hidden` on every other tab — so without this its update skeleton pulses for the life of the
  // page, invisible to a reader and indistinguishable from a real load to anything watching.
  const updatesLoading = updatesQ.isPending && updatesEnabled;
  const canEdit = aggregate?.capabilities.contribute ?? false;
  const canManage = aggregate?.capabilities.manage ?? false;
  const currentActorId = aggregate?.viewer.actorId ?? null;
  const memberOptions = useMemo<readonly PickerOption[]>(() => {
    const owner = aggregate?.references.owner;
    const options = memberActorOptions(members);
    if (!owner || options.some((option) => option.value === owner.actorId)) return options;
    return [{ value: owner.actorId, label: owner.displayName }, ...options];
  }, [aggregate?.references.owner, members]);
  const assignedLabels = selectedLabelsQ.data?.items ?? [];
  const availableLabels = useMemo(
    () =>
      (labelsQ.data?.items ?? []).filter(
        (label) => label.teamId === null || label.teamId === undefined,
      ),
    [labelsQ.data?.items],
  );
  const status = useWorkStatus('initiative', detail?.status ?? '');

  useEffect(() => {
    setTerminalState(null);
  }, [initiativeId]);

  useEffect(() => {
    if (aggregate) seedNavigationSnapshot(aggregate.snapshot);
  }, [aggregate]);

  useEffect(() => {
    if (terminalFailure === null) return;
    setTerminalState(terminalFailure);
    setAggregateEnabled(false);
    void removeNavigationSnapshot('initiative', initiativeId);
    queryClient.removeQueries({ queryKey: aggregateKey, exact: true });
  }, [aggregateKey, initiativeId, queryClient, terminalFailure]);

  useInitiativePageIdentity(orgId, initiativeId, detail?.name ?? navigationSnapshot?.name);

  const mutations = useInitiativeMutations(
    orgId,
    initiativeId,
    initiativeNoun.toLowerCase(),
    programNoun.toLowerCase(),
    projectNoun.toLowerCase(),
  );
  const connectedWorkActions = useConnectedWorkActions({
    orgId,
    initiativeId,
    canEdit,
    enabled: RELATIONSHIP_TABS.includes(tab),
    connectedWork,
    projectNoun,
    mutations,
  });
  const createLabel = useCreateLabel(orgId);
  const postUpdate = useApiMutation<UpdateOut, { body: string; health?: Health }>({
    mutationFn: (input) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].updates.$post({
            param: { orgId },
            json: {
              ...subject,
              body: input.body,
              ...(input.health ? { health: input.health } : {}),
            },
          }),
        'Could not post the update.',
      ),
    invalidateKeys: [updatesKey, aggregateKey, queryKeys.initiatives(orgId)],
  });
  const addResource = useApiMutation<AttachmentOut, { title: string; url: string }>({
    mutationFn: (json) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives[':id'].resources.$post({
            param: { orgId, id: initiativeId },
            json,
          }),
        'Could not add the resource.',
      ),
    invalidateKeys: [resourcesKey],
  });
  const removeResource = useApiMutation<{ id: string; removed: true }, string>({
    mutationFn: (resourceId) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives[':id'].resources[':resourceId'].$delete({
            param: { orgId, id: initiativeId, resourceId },
          }),
        'Could not remove the resource.',
      ),
    invalidateKeys: [resourcesKey],
  });
  const deleteInitiative = useApiMutation({
    mutationFn: () =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives[':id'].$delete({
            param: { orgId, id: initiativeId },
          }),
        'Could not delete this initiative.',
      ),
    invalidateKeys: [queryKeys.initiatives(orgId)],
    onSuccess: () => {
      router.push(`/orgs/${orgId}/initiatives`);
    },
  });

  if (terminalState !== null) {
    return (
      <DetailUnavailable
        noun={initiativeNoun.toLowerCase()}
        forbidden={terminalState === 'forbidden'}
        backHref={`/orgs/${orgId}/initiatives`}
        backLabel={`Back to ${initiativePlural.toLowerCase()}`}
      />
    );
  }
  if (aggregateState === 'loading')
    return (
      <>
        <ContainerDetailLoading
          target="initiative"
          id={initiativeId}
          entityName={initiativeNoun}
          tabCount={5}
          snapshot={navigationSnapshot}
        />
        {aggregateQ.isError ? (
          <div className="px-6 pb-6">
            <PartialLoadBanner title={refreshTitle} onRetry={() => void aggregateQ.refetch()} />
          </div>
        ) : null}
      </>
    );
  if (aggregateState === 'error')
    return <QueryLoadFailure title={`This ${initiativeNoun.toLowerCase()}`} query={aggregateQ} />;
  if (!detail) return <p className="mx-auto max-w-7xl p-6">Initiative not found.</p>;

  const resolveActor = (actorId: string | null | undefined): ResolvedActor =>
    resolveInitiativeActor(members, initiativeOwner, actorId);
  const ownerName = aggregate?.references.owner?.displayName ?? '—';
  const initiativeObject = {
    kind: 'initiative' as const,
    id: initiativeId,
    organizationId: orgId,
    title: detail.name,
    meta: {
      parentInitiativeId: aggregate?.references.parent?.id ?? null,
      parentLinkId: aggregate?.references.parentLinkId ?? null,
    },
  };
  const parent = aggregate?.references.parent ?? null;

  return (
    <EntityDetailLayout
      object={initiativeObject}
      printSummary={
        <DetailPrintSummary
          title={detail.name}
          summary={detail.summary}
          description={detail.description}
          properties={initiativePrintProperties(detail, {
            statusName: status.name,
            ownerName,
            labels: assignedLabels,
          })}
        />
      }
      eyebrow={
        parent ? (
          <nav
            className="no-print text-on-surface-variant flex items-center gap-2 text-sm"
            aria-label="Breadcrumb"
          >
            <Link
              href={`/orgs/${parent.organizationId}/initiatives/${parent.id}`}
              className="hover:text-on-surface inline-flex items-center gap-1"
            >
              <CornerDownLeft className="size-4" />
              {parent.name}
            </Link>
          </nav>
        ) : undefined
      }
      icon={
        <EntityIconPicker
          display={entityDisplay.display}

          workspaceId={orgId}
          entityName={detail.name}
          editable={canEdit}
          pending={entityDisplay.mutation.isPending}
          loading={entityDisplay.loading}
          size={48}
          onChange={(glyph, colorKey, customColor) => {
            entityDisplay.mutation.mutate({ glyph, colorKey, customColor });
          }}
        />
      }
      title={
        <EditableTitle
          value={detail.name}
          onSave={(name) => {
            mutations.patchInitiative({ name });
          }}
          canEdit={canEdit}
          ariaLabel={`${initiativeNoun} name`}
          className="text-on-surface"
        />
      }
      subtitle={
        <EditableSubtitle
          value={detail.summary}
          placeholder="Add a concise strategic summary"
          canEdit={canEdit}
          ariaLabel={`${initiativeNoun} summary`}
          onSave={(summary) => {
            mutations.patchInitiative({ summary });
          }}
          className="text-on-surface-variant text-body-large"
        />
      }
      metadata={
        <InitiativeMastheadMetadata
          initiativeNoun={initiativeNoun}
          detail={detail}
          canEdit={canEdit}
          patch={mutations.patchInitiative}
          planningCalendar={planningCalendar}
          owner={{
            options: memberOptions,
            pickerOpen: ownerPickerOpen,
            onPickerOpenChange: setOwnerPickerOpen,
            loading: ownerPickerOpen && membersQ.isPending,
            failed: ownerPickerOpen && membersQ.isError,
            onRetry: () => void membersQ.refetch(),
          }}
          labels={{
            assigned: assignedLabels,
            available: availableLabels,
            pickerOpen: labelsPickerOpen,
            onPickerOpenChange: setLabelsPickerOpen,
            loading:
              labelsPickerOpen &&
              !selectedLabelsQ.isError &&
              !labelsQ.isError &&
              (selectedLabelsQ.data === undefined || labelsQ.data === undefined),
            failed: labelsPickerOpen && (selectedLabelsQ.isError || labelsQ.isError),
            onRetry: () => {
              void selectedLabelsQ.refetch();
              void labelsQ.refetch();
            },
            canCreate: selectedLabelsQ.data !== undefined,
            onCreate: (name) => {
              createLabel.mutate(
                { name },
                {
                  onSuccess: (created) => {
                    mutations.patchInitiative({
                      labelIds: [...assignedLabels.map((label) => label.id), created.id],
                    });
                  },
                },
              );
            },
            onChange: (labelIds) => {
              if (selectedLabelsQ.data === undefined) return;
              mutations.patchInitiative({ labelIds: [...labelIds] });
            },
          }}
          targetPickerOpen={targetPickerOpen}
          onTargetPickerOpenChange={setTargetPickerOpen}
          displayFailed={entityDisplay.error !== null}
          onManageHierarchy={(anchor) => {
            pickerOverlay.open({
              kind: 'initiative-hierarchy',
              mode: 'parent',
              organizationId: orgId,
              subject: initiativeObject,
              anchor,
            });
          }}
        />
      }
      actions={
        // One ControlGroup at the row level, and no control inside it declares a height. That is
        // what makes the publish icon and the overflow icon provably the same size
        // rather than the same size until someone edits one of them.
        <ControlGroup controlSize="xl">
          <PlanWithAthenaAction orgId={orgId} initiativeId={initiativeId} enabled={canEdit} />
          <PublishAction
            orgId={orgId}
            subjectKind="initiative"
            subjectId={initiativeId}
            title={detail.name}
            noun={initiativeNoun}
            canPublish={canEdit}
          />
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" iconOnly aria-label={`${initiativeNoun} actions`}>
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  destructive
                  onSelect={() => {
                    setConfirmDeleteOpen(true);
                  }}
                >
                  <Trash2 className="size-4" />
                  Delete {initiativeNoun.toLowerCase()}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </ControlGroup>
      }
      tabs={
        <Tabs
          variant="underline"
          // Scroll rather than demote. Five section names do not fit a phone, and the two answers
          // to that are a More menu that hides where you can go, or a lane you push sideways. The
          // second is what a person already expects from a row of tabs on a phone, and it needs no
          // measurement pass to decide what it is allowed to say.
          className="no-print max-w-full [scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden"
          value={tab}
          onValueChange={(value) => {
            setTab(value as TabId);
          }}
          label={`${initiativeNoun} sections`}
          items={[
            { value: 'overview', label: 'Overview', priority: 0 },
            { value: 'subinitiatives', label: 'Sub-initiatives', priority: 1 },
            { value: 'work', label: 'Connected work', priority: 2 },
            { value: 'updates', label: 'Updates', priority: 3 },
            { value: 'resources', label: 'Resources', priority: 4 },
          ]}
        />
      }
    >
      {aggregateQ.isError ? (
        <PartialLoadBanner title={refreshTitle} onRetry={() => void aggregateQ.refetch()} />
      ) : null}
      <ConfirmDestructiveDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Delete this ${initiativeNoun.toLowerCase()}?`}
        description={
          <>
            This permanently deletes &ldquo;{detail.name}&rdquo; and unlinks any connected work from
            it. The linked projects and programs themselves are kept. This can&rsquo;t be undone.
          </>
        }
        confirmLabel={`Delete ${initiativeNoun.toLowerCase()}`}
        pending={deleteInitiative.isPending}
        onConfirm={() => {
          deleteInitiative.mutate(undefined, {
            onSuccess: () => {
              setConfirmDeleteOpen(false);
            },
          });
        }}
      />

      {tab === 'updates' ? (
        <div
          className="no-print"
          role="tabpanel"
          id="tabpanel-updates"
          aria-labelledby="tab-updates"
        >
          <UpdatesPanel
            updates={updates}
            loading={updatesLoading}
            loadFailure={updatesQ.isError ? updatesQ : null}
            resolveActor={resolveActor}
            posting={postUpdate.isPending}
            onPost={async (body, health) => {
              await postUpdate.mutateAsync({ body, ...(health ? { health } : {}) });
            }}
            showHealthComposer
          />
        </div>
      ) : null}

      {tab === 'resources' ? (
        <div
          className="no-print"
          role="tabpanel"
          id="tabpanel-resources"
          aria-labelledby="tab-resources"
        >
          <ResourcesTab
            resources={resourcesQ.data?.items ?? []}
            loading={resourcesQ.isPending}
            canEdit={canEdit}
            pending={addResource.isPending || removeResource.isPending}
            error={resourcesQ.isError ? 'Could not load resources.' : null}
            onAdd={addResource.mutate}
            onRemove={removeResource.mutate}
            subject={{ type: 'initiative', id: initiativeId, organizationId: orgId }}
            mentionedExternal={entityMentions.external}
            mentionedEntities={entityMentions.entities}
            mentionsPending={entityMentions.isPending}
            hasProse={(detail.description ?? '').trim().length > 0}
          />
        </div>
      ) : null}

      {isRelationshipTab && relationshipsQ.isError ? (
        <PartialLoadBanner
          title={`${initiativeNoun} relationships could not load`}
          onRetry={() => void relationshipsQ.refetch()}
        >
          The rest of this {initiativeNoun.toLowerCase()} still works.
        </PartialLoadBanner>
      ) : (
        <InitiativeRelationshipPanels
          tab={tab}
          routeOrganizationId={orgId}
          initiativeId={initiativeId}
          children={relationships?.children ?? []}
          connectedWork={connectedWork}
          connectedWorkActions={connectedWorkActions}
          loading={relationshipsQ.isPending}
          initiativeNoun={initiativeNoun}
          initiativePlural={initiativePlural}
          programNoun={programNoun}
          projectNoun={projectNoun}
          truncated={relationships?.truncated ?? false}
          onAddSubinitiative={() => {
            pickerOverlay.open({
              kind: 'initiative-hierarchy',
              mode: 'child',
              organizationId: orgId,
              subject: initiativeObject,
            });
          }}
        />
      )}

      <div
        className={`${tab === 'overview' ? 'flex' : 'hidden'} initiative-overview min-w-0 flex-col gap-6`}
        role="tabpanel"
        id="tabpanel-overview"
        aria-labelledby="tab-overview"
      >
        <TemplateAwareEntityDocument
          orgId={orgId}
          kind="initiative"
          currentActorId={currentActorId}
          value={detail.description}
          canEdit={canEdit}
          onSave={(description) => {
            mutations.patchInitiative({ description });
          }}
          placeholder="Describe this initiative…"
        />
        {/* A summary, not the list again: the tab beside this one holds the rows and every
            control that changes them. What it cannot show at a glance is the health spread. */}
        {relationshipsQ.isError ? null : (
          <InitiativeWorkSummary
            connectedWork={connectedWork}
            distribution={detail.distribution}
            loading={relationshipsQ.isPending}
            canEdit={canEdit}
            initiativeNoun={initiativeNoun}
            programNoun={programNoun}
            projectNoun={projectNoun}
            onCreateProject={() => {
              connectedWorkActions.onCreateProject(null);
            }}
          />
        )}
        <LatestUpdateSummary
          updates={updates}
          loading={updatesLoading}
          resolveActor={(actorId) => resolveInitiativeActor([], initiativeOwner, actorId)}
        />
      </div>
    </EntityDetailLayout>
  );
}
