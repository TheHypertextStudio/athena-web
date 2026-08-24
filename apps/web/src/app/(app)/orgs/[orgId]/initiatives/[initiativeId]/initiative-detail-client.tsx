'use client';

import type {
  AttachmentOut,
  EntityDisplayColorKey,
  EntityDisplayIconKey,
  EntityDisplayOut,
  Health,
  LabelOut,
  UpdateOut,
} from '@docket/types';
import { defaultEntityDisplay, InitiativeSubjectRef } from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { ChevronLeft, CornerDownLeft, Ellipsis, Trash2 } from '@docket/ui/icons';
import {
  Button,
  ControlGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
  menuDestructiveItem,
} from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import Link from '@/components/docket-link';
import { useAppSearchParams, useTypedRoute } from '@/lib/app-location';
import { type JSX, useEffect, useMemo, useState } from 'react';

import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { TemplateAwareEntityDocument } from '@/components/editor/apply-description-template';
import { EditableSubtitle } from '@/components/editor/editable-subtitle';
import { EditableTitle } from '@/components/editor/editable-title';
import { ResourcesTab } from '@/components/entity-detail/resources-tab';
import { useEntityMentions } from '@/lib/use-entity-mentions';
import { UpdatesPanel } from '@/components/entity-detail/updates-panel';
import { EntityIconPicker } from '@/components/entity-display/entity-icon-picker';
import { useWorkStatus } from '@/components/entity-display/use-work-status';
import { InitiativeRelationshipPanels } from '@/components/initiatives/initiative-relationship-panels';
import {
  INITIATIVE_CADENCE_LABEL,
  INITIATIVE_PRIORITY_LABEL,
  InitiativePropertiesPanel,
} from '@/components/initiatives/properties-panel';

import { memberActorOptions } from '@/components/pickers/options';
import { usePickerOverlay } from '@/components/pickers/picker-overlay';
import { PublishAction } from '@/components/publishing/publish-action';
import { EntityDetailSkeleton } from '@/components/views/entity-detail-skeleton';
import {
  ENTITY_METADATA_CHIP_CLASS,
  EntityDetailLayout,
  EntityMetadataItem,
  EntityMetadataRow,
} from '@/components/views/entity-detail-layout';
import { useDocumentTitle } from '@/components/tabs/use-document-title';
import { useRegisterTabTitle } from '@/components/tabs/use-register-tab-title';
import { api } from '@/lib/api';
import { aggregateLoadState, initiativeDetailAggregateDef } from '@/lib/detail-aggregate';
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
import { userErrorMessage } from '@/lib/problem';
import { formatPlanningTimeframe, toPlanningTimeframe } from '@/lib/planning-timeframe';
import { useFiscalYearStartMonth } from '@/lib/use-fiscal-year-start-month';
import { useNavigationSnapshot } from '@/lib/use-navigation-snapshot';
import { useAppRouter } from '@/lib/interactions/navigation';
import { seedNavigationSnapshot } from '@/lib/navigation-snapshot-runtime';
import { orgMembersDef } from '@/lib/use-org-membership';

type TabId = 'overview' | 'subinitiatives' | 'work' | 'updates' | 'resources';

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
  const searchParams = useAppSearchParams();
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<TabId>(
    initialTab === 'subinitiatives' ||
      initialTab === 'work' ||
      initialTab === 'updates' ||
      initialTab === 'resources'
      ? initialTab
      : 'overview',
  );
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const [labelsPickerOpen, setLabelsPickerOpen] = useState(false);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [displayPickerOpen, setDisplayPickerOpen] = useState(false);
  const initiativeNoun = useVocabulary('initiative');
  const initiativePlural = useVocabulary('initiative', { plural: true });
  const programNoun = useVocabulary('program');
  const projectNoun = useVocabulary('project');
  const aggregateDef = initiativeDetailAggregateDef(orgId, initiativeId);
  const aggregateKey = aggregateDef.queryKey;
  const aggregateQ = useApiQuery(aggregateDef);
  const aggregate = aggregateQ.data ?? null;
  const detail = aggregate?.defaultView.initiative ?? null;
  const aggregateState = aggregateLoadState(
    aggregateQ.data,
    navigationSnapshot !== null,
    aggregateQ.isPending,
    aggregateQ.isError,
  );
  const relationshipsQ = useApiQuery({
    ...initiativeRelationshipSectionsDef(orgId, initiativeId),
    enabled: aggregate !== null && (tab === 'subinitiatives' || tab === 'work'),
  });
  const relationships = relationshipsQ.data ?? null;
  const entityMentions = useEntityMentions(
    orgId,
    subject,
    aggregate !== null && tab === 'resources',
  );
  const planningCalendar = useFiscalYearStartMonth(orgId, targetPickerOpen);
  const membersQ = useApiQuery({ ...orgMembersDef(orgId), enabled: ownerPickerOpen });
  const members = membersQ.data?.items ?? [];
  const selectedLabelsQ = useApiQuery(
    apiQueryOptions<readonly LabelOut[]>(
      [...aggregateKey, 'labels'],
      () =>
        api.v1.orgs[':orgId'].initiatives[':id'].labels.$get({
          param: { orgId, id: initiativeId },
        }),
      'Could not load Initiative labels.',
      { enabled: labelsPickerOpen },
    ),
  );
  const labelsQ = useApiListQuery({ ...labelsDef(orgId), enabled: labelsPickerOpen });
  const displayKey = [...aggregateKey, 'display'] as const;
  const displayQ = useApiQuery(
    apiQueryOptions(
      displayKey,
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$get({
          param: { orgId, ...subject },
        }),
      'Could not load display settings.',
      { enabled: displayPickerOpen },
    ),
  );
  const resourcesKey = [...aggregateKey, 'resources'] as const;
  const resourcesQ = useApiQuery(
    apiQueryOptions(
      resourcesKey,
      () =>
        api.v1.orgs[':orgId'].initiatives[':id'].resources.$get({
          param: { orgId, id: initiativeId },
        }),
      'Could not load resources.',
      { enabled: aggregate !== null && tab === 'resources' },
    ),
  );
  const updatesKey = [...aggregateKey, 'updates'] as const;
  const updatesQ = useApiQuery(
    apiQueryOptions(
      updatesKey,
      () =>
        api.v1.orgs[':orgId'].updates.$get({
          param: { orgId },
          query: subject,
        }),
      'Could not load updates.',
      { enabled: aggregate !== null && tab === 'updates' },
    ),
  );
  const updates = updatesQ.data?.items ?? [];
  const display = displayQ.data ?? defaultEntityDisplay('initiative', initiativeId);
  const canEdit = aggregate?.capabilities.contribute ?? false;
  const canManage = aggregate?.capabilities.manage ?? false;
  const currentActorId = aggregate?.viewer.actorId ?? null;
  const memberOptions = useMemo<readonly PickerOption[]>(() => {
    const owner = aggregate?.references.owner;
    const options = memberActorOptions(members);
    if (!owner || options.some((option) => option.value === owner.actorId)) return options;
    return [{ value: owner.actorId, label: owner.displayName }, ...options];
  }, [aggregate?.references.owner, members]);
  const assignedLabels = selectedLabelsQ.data ?? [];
  const availableLabels = useMemo(
    () =>
      (labelsQ.data?.items ?? []).filter(
        (label) => label.teamId === null || label.teamId === undefined,
      ),
    [labelsQ.data?.items],
  );
  const status = useWorkStatus('initiative', detail?.status ?? '');

  useEffect(() => {
    if (aggregate) seedNavigationSnapshot(aggregate.snapshot);
  }, [aggregate]);

  useRegisterTabTitle('initiative', orgId, initiativeId, detail?.name ?? navigationSnapshot?.name);
  useDocumentTitle(detail?.name ?? navigationSnapshot?.name);

  const mutations = useInitiativeMutations(
    orgId,
    initiativeId,
    initiativeNoun.toLowerCase(),
    programNoun.toLowerCase(),
    projectNoun.toLowerCase(),
  );
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
  const displayMutation = useApiMutation<
    EntityDisplayOut,
    { iconKey: EntityDisplayIconKey; colorKey: EntityDisplayColorKey; customColor: string | null },
    { previous?: EntityDisplayOut | undefined }
  >({
    mutationFn: (json) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$put({
            param: { orgId, ...subject },
            json,
          }),
        `Could not customize this ${initiativeNoun.toLowerCase()}.`,
      ),
    onMutate: async ({ iconKey, colorKey, customColor }) => {
      await queryClient.cancelQueries({ queryKey: displayKey });
      const previous = queryClient.getQueryData<EntityDisplayOut>(displayKey);
      queryClient.setQueryData<EntityDisplayOut>(displayKey, {
        ...subject,
        iconKey,
        colorKey,
        customColor,
        // The icon/color picker never touches the cover, so an optimistic update must carry the
        // stored one through rather than blanking it until the refetch lands.
        coverImage: previous?.coverImage ?? null,
        customized: true,
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(displayKey, context.previous);
    },
    invalidateKeys: [
      displayKey,
      queryKeys.initiatives(orgId),
      queryKeys.entityDisplays(orgId, 'initiative'),
    ],
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

  if (aggregateState === 'loading' || aggregateState === 'snapshot')
    return (
      <>
        <EntityDetailSkeleton
          label={`Loading ${initiativeNoun.toLowerCase()}`}
          title={navigationSnapshot?.name}
          snapshotMetadata={
            navigationSnapshot ? (
              <span className="text-on-surface-variant text-body-small">
                {navigationSnapshot.status} · {navigationSnapshot.priority}
                {navigationSnapshot.health ? ` · ${navigationSnapshot.health}` : ''}
              </span>
            ) : undefined
          }
        />
        {aggregateQ.isError ? (
          <p role="alert" className="text-error text-body-medium px-6 pb-6">
            Could not refresh this {initiativeNoun.toLowerCase()}.
          </p>
        ) : null}
      </>
    );
  if (aggregateState === 'error')
    return (
      <p role="alert" className="text-error mx-auto max-w-7xl p-6">
        {userErrorMessage(aggregateQ.error, 'Could not load this initiative.')}
      </p>
    );
  if (!detail) return <p className="mx-auto max-w-7xl p-6">Initiative not found.</p>;

  const resolveActor = (actorId: string | null | undefined) => {
    const member = members.find((item) => item.actorId === actorId);
    const owner = aggregate?.references.owner;
    return {
      name:
        member?.displayName ??
        (owner?.actorId === actorId ? (owner?.displayName ?? 'Unknown') : 'Unknown'),
      kind: 'human' as const,
    };
  };
  const ownerName = aggregate?.references.owner?.displayName ?? '—';
  const initiativeObject = {
    kind: 'initiative' as const,
    id: initiativeId,
    organizationId: orgId,
    title: detail.name,
    meta: {
      parentInitiativeId: relationships?.parent?.id ?? null,
      parentLinkId: relationships?.parentLinkId ?? null,
    },
  };

  return (
    <EntityDetailLayout
      className="initiative-print"
      object={initiativeObject}
      eyebrow={
        <nav
          className="no-print text-on-surface-variant flex items-center gap-2 text-sm"
          aria-label="Breadcrumb"
        >
          <Link
            href={`/orgs/${orgId}/initiatives`}
            className="hover:text-on-surface inline-flex items-center gap-1"
          >
            <ChevronLeft className="size-4" />
            All {initiativePlural.toLowerCase()}
          </Link>
          {relationships?.parent ? (
            <>
              <span aria-hidden>/</span>
              <Link
                href={`/orgs/${relationships.parent.organizationId}/initiatives/${relationships.parent.id}`}
                className="hover:text-on-surface truncate"
              >
                {relationships.parent.name}
              </Link>
            </>
          ) : null}
        </nav>
      }
      icon={
        <EntityIconPicker
          display={display}
          entityName={detail.name}
          editable={canEdit}
          pending={displayMutation.isPending}
          loading={displayPickerOpen && displayQ.isPending}
          size={48}
          onChange={(iconKey, colorKey, customColor) => {
            if (displayQ.data === undefined) return;
            displayMutation.mutate({ iconKey, colorKey, customColor });
          }}
          onOpenChange={setDisplayPickerOpen}
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
        <div className="no-print">
          <EntityMetadataRow ariaLabel={`${initiativeNoun} properties`}>
            <InitiativePropertiesPanel
              status={detail.status}
              health={detail.health ?? null}
              targetDate={detail.targetDate ?? null}
              targetDateResolution={detail.targetDateResolution}
              targetDateFiscalYearStartMonth={detail.targetDateFiscalYearStartMonth}
              fiscalYearStartMonth={planningCalendar.fiscalYearStartMonth}
              planningCalendarLoading={planningCalendar.loading}
              ownerId={detail.ownerId ?? null}
              priority={detail.priority}
              updateCadence={detail.updateCadence}
              memberOptions={memberOptions}
              ownerLoading={ownerPickerOpen && membersQ.isPending}
              onOwnerPickerOpenChange={setOwnerPickerOpen}
              labels={assignedLabels}
              availableLabels={availableLabels}
              labelsLoading={
                labelsPickerOpen &&
                !selectedLabelsQ.isError &&
                !labelsQ.isError &&
                (selectedLabelsQ.data === undefined || labelsQ.data === undefined)
              }
              onLabelsPickerOpenChange={setLabelsPickerOpen}
              onTargetPickerOpenChange={setTargetPickerOpen}
              canEdit={canEdit}
              onStatusChange={(status) => {
                mutations.patchInitiative({ status });
              }}
              onHealthChange={(health) => {
                mutations.patchInitiative({ health });
              }}
              onTargetChange={(target) => {
                mutations.patchInitiative({
                  targetDate: target?.date ?? null,
                  targetDateResolution: target?.resolution ?? null,
                });
              }}
              onOwnerChange={(ownerId) => {
                mutations.patchInitiative({ ownerId });
              }}
              onPriorityChange={(priority) => {
                mutations.patchInitiative({ priority });
              }}
              onCadenceChange={(updateCadence) => {
                mutations.patchInitiative({ updateCadence });
              }}
              onLabelsChange={(labelIds) => {
                if (selectedLabelsQ.data === undefined) return;
                mutations.patchInitiative({ labelIds: [...labelIds] });
              }}
              {...(selectedLabelsQ.data === undefined
                ? {}
                : {
                    onCreateLabel: (name: string) => {
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
                  })}
            />
            <EntityMetadataItem priority={7} overflowOnly>
              <Button
                variant="ghost"
                className={ENTITY_METADATA_CHIP_CLASS}
                onClick={(event) => {
                  pickerOverlay.open({
                    kind: 'initiative-hierarchy',
                    mode: 'parent',
                    organizationId: orgId,
                    subject: initiativeObject,
                    anchor: event.currentTarget,
                  });
                }}
              >
                <CornerDownLeft aria-hidden className="size-5" />
                Manage hierarchy
              </Button>
            </EntityMetadataItem>
          </EntityMetadataRow>
          {mutations.propsError ||
          (targetPickerOpen ? planningCalendar.error : null) ||
          (ownerPickerOpen && membersQ.isError ? 'Could not load members.' : null) ||
          (labelsPickerOpen && (selectedLabelsQ.isError || labelsQ.isError)
            ? 'Could not load labels.'
            : null) ? (
            <p role="alert" className="text-error mt-2 text-sm">
              {mutations.propsError ??
                planningCalendar.error ??
                (ownerPickerOpen && membersQ.isError ? 'Could not load members.' : null) ??
                (labelsPickerOpen && (selectedLabelsQ.isError || labelsQ.isError)
                  ? 'Could not load labels.'
                  : null)}
            </p>
          ) : null}
          {displayMutation.error ? (
            <p role="alert" className="text-error mt-2 text-sm">
              {userErrorMessage(
                displayMutation.error,
                `Could not customize this ${initiativeNoun.toLowerCase()}.`,
              )}
            </p>
          ) : null}
          {displayPickerOpen && displayQ.isError ? (
            <p role="alert" className="text-error mt-2 text-sm">
              Could not load display settings.
            </p>
          ) : null}
        </div>
      }
      actions={
        // One ControlGroup at the row level, and no control inside it declares a height. That is
        // what makes the publish icon and the overflow icon provably the same size
        // rather than the same size until someone edits one of them.
        <ControlGroup controlSize="xl">
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
                  className={menuDestructiveItem()}
                  onSelect={() => {
                    deleteInitiative.reset();
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
          className="no-print"
          value={tab}
          onValueChange={(value) => {
            setTab(value as TabId);
          }}
          label={`${initiativeNoun} sections`}
          items={[
            { value: 'overview', label: 'Overview' },
            { value: 'subinitiatives', label: 'Sub-initiatives' },
            { value: 'work', label: 'Connected work' },
            { value: 'updates', label: 'Updates' },
            { value: 'resources', label: 'Resources' },
          ]}
        />
      }
    >
      {aggregateQ.isError ? (
        <p role="alert" className="text-error text-sm">
          Could not refresh this {initiativeNoun.toLowerCase()}.
        </p>
      ) : null}
      <ConfirmDestructiveDialog
        open={confirmDeleteOpen}
        onOpenChange={(next) => {
          // Clear any prior failure so a stale message never shows on reopen.
          deleteInitiative.reset();
          setConfirmDeleteOpen(next);
        }}
        title={`Delete this ${initiativeNoun.toLowerCase()}?`}
        description={
          <>
            This permanently deletes &ldquo;{detail.name}&rdquo; and unlinks any connected work from
            it. The linked projects and programs themselves are kept. This can&rsquo;t be undone.
          </>
        }
        error={
          deleteInitiative.error
            ? userErrorMessage(
                deleteInitiative.error,
                `Could not delete this ${initiativeNoun.toLowerCase()}.`,
              )
            : null
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

      <section className="print-only border-outline-variant border-y py-4">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <PrintProperty label="Status" value={status.name} />
          <PrintProperty
            label="Initiative health"
            value={detail.health ? detail.health.replace('_', ' ') : '—'}
          />
          <PrintProperty
            label="Connected-work health"
            value={detail.rolledUpHealth ? detail.rolledUpHealth.replace('_', ' ') : '—'}
          />
          <PrintProperty label="Priority" value={INITIATIVE_PRIORITY_LABEL[detail.priority]} />
          <PrintProperty label="Owner" value={ownerName} />
          <PrintProperty
            label="Target"
            value={
              formatPlanningTimeframe(
                toPlanningTimeframe(
                  detail.targetDate,
                  detail.targetDateResolution,
                  detail.targetDateFiscalYearStartMonth,
                ),
              ) ?? '—'
            }
          />
          <PrintProperty
            label="Update cadence"
            value={INITIATIVE_CADENCE_LABEL[detail.updateCadence]}
          />
          <PrintProperty
            label="Labels"
            value={assignedLabels.map((label) => label.name).join(', ') || '—'}
          />
        </dl>
        {(resourcesQ.data?.items ?? []).length ? (
          <div className="mt-4 text-sm">
            <p className="font-medium">Resources</p>
            <ul className="mt-1 list-disc pl-5">
              {(resourcesQ.data?.items ?? []).map((resource) => (
                <li key={resource.id}>
                  {resource.title}
                  {resource.url ? ` — ${resource.url}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {tab === 'updates' ? (
        <div
          className="no-print"
          role="tabpanel"
          id="tabpanel-updates"
          aria-labelledby="tab-updates"
        >
          <UpdatesPanel
            updates={updates}
            loading={updatesQ.isPending}
            error={
              updatesQ.isError ? userErrorMessage(updatesQ.error, 'Could not load updates.') : null
            }
            resolveActor={resolveActor}
            posting={postUpdate.isPending}
            postError={
              postUpdate.error
                ? userErrorMessage(postUpdate.error, 'Could not post the update.')
                : null
            }
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
            error={
              resourcesQ.isError
                ? 'Could not load resources.'
                : addResource.error
                  ? userErrorMessage(addResource.error, 'Could not add the resource.')
                  : removeResource.error
                    ? userErrorMessage(removeResource.error, 'Could not remove the resource.')
                    : null
            }
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

      {(tab === 'subinitiatives' || tab === 'work') && relationshipsQ.isError ? (
        <p role="alert" className="text-error text-sm">
          Could not load Initiative relationships.
        </p>
      ) : (
        <>
          {relationships?.truncated ? (
            <p className="text-on-surface-variant text-sm">
              Some relationships are not shown. Browse all{' '}
              <Link href={`/orgs/${orgId}/initiatives`} className="underline">
                {initiativePlural.toLowerCase()}
              </Link>
              ,{' '}
              <Link href={`/orgs/${orgId}/projects`} className="underline">
                {projectNoun.toLowerCase()}s
              </Link>
              , or{' '}
              <Link href={`/orgs/${orgId}/programs`} className="underline">
                {programNoun.toLowerCase()}s
              </Link>
              .
            </p>
          ) : null}
          <InitiativeRelationshipPanels
            tab={tab}
            children={relationships?.children ?? []}
            connectedWork={relationships?.connectedWork ?? []}
            loading={relationshipsQ.isPending}
            initiativeNoun={initiativeNoun}
            programNoun={programNoun}
            projectNoun={projectNoun}
            onAddSubinitiative={() => {
              pickerOverlay.open({
                kind: 'initiative-hierarchy',
                mode: 'child',
                organizationId: orgId,
                subject: initiativeObject,
              });
            }}
          />
        </>
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
      </div>

      <style jsx global>{`
        .print-only {
          display: none;
        }
        @media print {
          .print-only {
            display: block !important;
          }
          .no-print,
          nav:not(.entity-contents) {
            display: none !important;
          }
          .entity-contents-desktop {
            display: block !important;
          }
          .entity-contents-mobile {
            display: none !important;
          }
          .initiative-print {
            max-width: none !important;
            padding: 0 !important;
          }
          .initiative-overview {
            display: flex !important;
          }
          .entity-document button {
            border: 0 !important;
            padding: 0 !important;
          }
        }
      `}</style>
    </EntityDetailLayout>
  );
}

function PrintProperty({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-4 border-b py-1">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="text-right capitalize">{value}</dd>
    </div>
  );
}
