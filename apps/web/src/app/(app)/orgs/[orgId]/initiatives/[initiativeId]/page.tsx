'use client';

import type {
  AttachmentOut,
  EntityDisplayColorKey,
  EntityDisplayIconKey,
  EntityDisplayOut,
  Health,
  UpdateOut,
} from '@docket/types';
import { defaultEntityDisplay } from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { ChevronLeft, Ellipsis, Trash2 } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
  Tabs,
} from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { type JSX, useMemo, useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog';
import { EditableFreeformText } from '@/components/editor/freeform-text';
import { EditableTitle } from '@/components/editor/editable-title';
import { EntityDocument } from '@/components/editor/entity-document';
import { ResourcesTab } from '@/components/entity-detail/resources-tab';
import { UpdatesPanel } from '@/components/entity-detail/updates-panel';
import { InitiativeIconPicker } from '@/components/initiatives/initiative-icon-picker';
import {
  INITIATIVE_CADENCE_LABEL,
  INITIATIVE_PRIORITY_LABEL,
  INITIATIVE_STATUS_LABEL,
  InitiativePropertiesPanel,
} from '@/components/initiatives/properties-panel';
import { memberActorOptions } from '@/components/property-pickers/options';
import { EntityDetailLayout, EntityMetadataRow } from '@/components/views/entity-detail-layout';
import { api } from '@/lib/api';
import { initiativeDetailDef } from '@/lib/fetch-initiative-detail';
import { queryKeys, apiQueryOptions, useApiMutation, useApiQuery, unwrap } from '@/lib/query';
import { useInitiativeMutations } from '@/lib/use-initiative-mutations';
import { useOrgCapability } from '@/lib/use-org-capability';
import { userErrorMessage } from '@/lib/problem';

type TabId = 'overview' | 'updates' | 'resources';

/** Printable, document-first Initiative detail composed from the shared entity-detail shell. */
export default function InitiativeDetailPage(): JSX.Element {
  const { orgId, initiativeId } = useParams<{ orgId: string; initiativeId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<TabId>(
    initialTab === 'updates' || initialTab === 'resources' ? initialTab : 'overview',
  );
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const initiativeNoun = useVocabulary('initiative');
  const initiativePlural = useVocabulary('initiative', { plural: true });
  const programNoun = useVocabulary('program');
  const projectNoun = useVocabulary('project');
  const detailQ = useApiQuery(initiativeDetailDef(orgId, initiativeId));
  const data = detailQ.data;
  const detail = data?.detail;
  const updatesKey = [...queryKeys.initiative(orgId, initiativeId), 'updates'] as const;
  const updatesQ = useApiQuery(
    apiQueryOptions(
      updatesKey,
      () =>
        api.v1.orgs[':orgId'].updates.$get({
          param: { orgId },
          query: { subjectType: 'initiative', subjectId: initiativeId },
        }),
      'Could not load updates.',
    ),
  );
  const updates = updatesQ.data?.items ?? [];

  const displayKey = [...queryKeys.initiative(orgId, initiativeId), 'display'] as const;
  const displayQ = useApiQuery(
    apiQueryOptions(
      displayKey,
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$get({
          param: { orgId, subjectType: 'initiative', subjectId: initiativeId },
        }),
      'Could not load display settings.',
    ),
  );
  const display = displayQ.data ?? defaultEntityDisplay('initiative', initiativeId);

  const members = data?.members ?? [];
  const roles = data?.roles ?? [];
  const canEdit = useOrgCapability(members, roles, 'contribute');
  const canManage = useOrgCapability(members, roles, 'manage');
  const memberOptions = useMemo<readonly PickerOption[]>(
    () => memberActorOptions(members),
    [members],
  );
  const children = detail?.children ?? [];
  const availableLabels = useMemo(
    () =>
      (data?.labels ?? []).filter((label) => label.teamId === null || label.teamId === undefined),
    [data?.labels],
  );

  const mutations = useInitiativeMutations(
    orgId,
    initiativeId,
    initiativeNoun.toLowerCase(),
    programNoun.toLowerCase(),
    projectNoun.toLowerCase(),
  );
  const postUpdate = useApiMutation<UpdateOut, { body: string; health?: Health }>({
    mutationFn: (input) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].updates.$post({
            param: { orgId },
            json: {
              subjectType: 'initiative',
              subjectId: initiativeId,
              body: input.body,
              ...(input.health ? { health: input.health } : {}),
            },
          }),
        'Could not post the update.',
      ),
    invalidateKeys: [
      updatesKey,
      queryKeys.initiative(orgId, initiativeId),
      queryKeys.initiatives(orgId),
    ],
  });
  const displayMutation = useApiMutation<
    EntityDisplayOut,
    { iconKey: EntityDisplayIconKey; colorKey: EntityDisplayColorKey; customColor: string | null },
    { previous?: EntityDisplayOut }
  >({
    mutationFn: (json) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$put({
            param: { orgId, subjectType: 'initiative', subjectId: initiativeId },
            json,
          }),
        `Could not customize this ${initiativeNoun.toLowerCase()}.`,
      ),
    onMutate: async ({ iconKey, colorKey, customColor }) => {
      await queryClient.cancelQueries({ queryKey: displayKey });
      const previous = queryClient.getQueryData<EntityDisplayOut>(displayKey);
      queryClient.setQueryData<EntityDisplayOut>(displayKey, {
        subjectType: 'initiative',
        subjectId: initiativeId,
        iconKey,
        colorKey,
        customColor,
        customized: true,
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(displayKey, context.previous);
    },
    invalidateKeys: [displayKey, queryKeys.initiatives(orgId)],
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
    invalidateKeys: [queryKeys.initiative(orgId, initiativeId)],
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
    invalidateKeys: [queryKeys.initiative(orgId, initiativeId)],
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

  if (detailQ.isPending)
    return (
      <div className="mx-auto max-w-7xl space-y-5 p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  if (detailQ.isError || !detail)
    return (
      <p role="alert" className="text-destructive mx-auto max-w-7xl p-6">
        {detailQ.isError
          ? userErrorMessage(detailQ.error, 'Could not load this initiative.')
          : 'Initiative not found.'}
      </p>
    );

  const resolveActor = (actorId: string | null | undefined) => {
    const member = members.find((item) => item.actorId === actorId);
    return { name: member?.displayName ?? 'Unknown', kind: 'human' as const };
  };
  const ownerName = members.find((member) => member.actorId === detail.ownerId)?.displayName ?? '—';

  return (
    <EntityDetailLayout
      className="initiative-print"
      eyebrow={
        <div className="no-print flex items-center justify-between">
          <nav
            className="text-on-surface-variant flex items-center gap-2 text-sm"
            aria-label="Breadcrumb"
          >
            <Link
              href={`/orgs/${orgId}/initiatives`}
              className="hover:text-on-surface inline-flex items-center gap-1"
            >
              <ChevronLeft className="size-4" />
              All {initiativePlural.toLowerCase()}
            </Link>
            {detail.parent ? (
              <>
                <span aria-hidden>/</span>
                <Link
                  href={`/orgs/${detail.parent.organizationId}/initiatives/${detail.parent.id}`}
                  className="hover:text-on-surface truncate"
                >
                  {detail.parent.name}
                </Link>
              </>
            ) : null}
          </nav>
          <Button
            className="min-h-10"
            variant="ghost"
            size="sm"
            onClick={() => {
              window.print();
            }}
          >
            Print
          </Button>
        </div>
      }
      icon={
        <InitiativeIconPicker
          display={display}
          initiativeName={detail.name}
          editable={canEdit}
          pending={displayMutation.isPending}
          onChange={(iconKey, colorKey, customColor) => {
            displayMutation.mutate({ iconKey, colorKey, customColor });
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
          saving={mutations.propsPending}
          ariaLabel={`${initiativeNoun} name`}
          className="text-on-surface"
        />
      }
      subtitle={
        <EditableFreeformText
          value={detail.summary}
          placeholder="Add a concise strategic summary"
          canEdit={canEdit}
          saving={mutations.propsPending}
          onSave={(summary) => {
            mutations.patchInitiative({ summary });
          }}
          className="text-on-surface-variant text-body-large leading-relaxed"
        />
      }
      metadata={
        <div className="no-print">
          <EntityMetadataRow ariaLabel={`${initiativeNoun} properties`}>
            <InitiativePropertiesPanel
              status={detail.status}
              health={detail.health ?? null}
              rolledUpHealth={detail.rolledUpHealth}
              targetDate={detail.targetDate ?? null}
              ownerId={detail.ownerId ?? null}
              priority={detail.priority}
              updateCadence={detail.updateCadence}
              memberOptions={memberOptions}
              labels={detail.labels}
              availableLabels={availableLabels}
              canEdit={canEdit}
              onStatusChange={(status) => {
                mutations.patchInitiative({ status });
              }}
              onHealthChange={(health) => {
                mutations.patchInitiative({ health });
              }}
              onTargetChange={(targetDate) => {
                mutations.patchInitiative({ targetDate });
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
                mutations.patchInitiative({ labelIds: [...labelIds] });
              }}
            />
          </EntityMetadataRow>
          {mutations.propsError ? (
            <p role="alert" className="text-destructive mt-2 text-sm">
              {mutations.propsError}
            </p>
          ) : null}
          {displayMutation.error ? (
            <p role="alert" className="text-destructive mt-2 text-sm">
              {userErrorMessage(
                displayMutation.error,
                `Could not customize this ${initiativeNoun.toLowerCase()}.`,
              )}
            </p>
          ) : null}
        </div>
      }
      actions={
        canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="min-h-10"
                variant="ghost"
                size="icon"
                aria-label={`${initiativeNoun} actions`}
              >
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
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
        ) : null
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
            {
              value: 'updates',
              label: 'Updates',
              ...(updates.length ? { count: updates.length } : {}),
            },
            {
              value: 'resources',
              label: 'Resources',
              ...(detail.resources.length ? { count: detail.resources.length } : {}),
            },
          ]}
        />
      }
    >
      <ConfirmDeleteDialog
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
          <PrintProperty label="Status" value={INITIATIVE_STATUS_LABEL[detail.status]} />
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
            value={detail.targetDate ? detail.targetDate.slice(0, 10) : '—'}
          />
          <PrintProperty
            label="Update cadence"
            value={INITIATIVE_CADENCE_LABEL[detail.updateCadence]}
          />
          <PrintProperty
            label="Labels"
            value={detail.labels.map((label) => label.name).join(', ') || '—'}
          />
        </dl>
        {detail.resources.length ? (
          <div className="mt-4 text-sm">
            <p className="font-medium">Resources</p>
            <ul className="mt-1 list-disc pl-5">
              {detail.resources.map((resource) => (
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
            onPost={(body, health) => {
              postUpdate.mutate({ body, ...(health ? { health } : {}) });
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
            resources={detail.resources}
            canEdit={canEdit}
            pending={addResource.isPending || removeResource.isPending}
            error={
              addResource.error
                ? userErrorMessage(addResource.error, 'Could not add the resource.')
                : removeResource.error
                  ? userErrorMessage(removeResource.error, 'Could not remove the resource.')
                  : null
            }
            onAdd={addResource.mutate}
            onRemove={removeResource.mutate}
          />
        </div>
      ) : null}

      <div
        className={`${tab === 'overview' ? 'flex' : 'hidden'} initiative-overview min-w-0 flex-col gap-10`}
        role="tabpanel"
        id="tabpanel-overview"
        aria-labelledby="tab-overview"
      >
        {detail.latestUpdate ? (
          <section className="bg-surface-container-low rounded-xl px-5 py-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-on-surface text-sm font-medium">Latest update</h2>
              <span className="text-on-surface-variant text-xs">
                {detail.latestUpdate.createdAt.slice(0, 10)}
              </span>
            </div>
            <p className="text-on-surface text-sm leading-relaxed whitespace-pre-wrap">
              {detail.latestUpdate.body}
            </p>
          </section>
        ) : null}
        <EntityDocument
          value={detail.description}
          canEdit={canEdit}
          saving={mutations.propsPending}
          onSave={(description) => {
            mutations.patchInitiative({ description });
          }}
          placeholder="Add the Initiative brief…"
        />
        <section>
          <h2 className="text-on-surface text-title-small mb-3">Sub-initiatives</h2>
          {children.length ? (
            <div className="bg-surface-container-low flex flex-col rounded-xl p-1">
              {children.map((child) => (
                <Link
                  key={child.id}
                  href={`/orgs/${child.organizationId}/initiatives/${child.id}`}
                  className="hover:bg-surface-container-high flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors"
                >
                  <span className="min-w-0 truncate">{child.name}</span>
                  <span className="text-on-surface-variant shrink-0">
                    {INITIATIVE_STATUS_LABEL[child.status]}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="bg-surface-container-low text-on-surface-variant rounded-xl px-4 py-6 text-center text-sm">
              Nothing's nested under this one yet.
            </p>
          )}
        </section>
        <section>
          <h2 className="text-on-surface text-title-small mb-3">Connected work</h2>
          {detail.connectedWork.length ? (
            <div className="bg-surface-container-low flex flex-col rounded-xl p-1">
              {detail.connectedWork.map((item) => (
                <div
                  key={`${item.kind}-${item.id}`}
                  className="hover:bg-surface-container-high flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors"
                >
                  <span className="min-w-0 truncate">{item.name}</span>
                  <span className="text-on-surface-variant ml-3 shrink-0">
                    {item.kind === 'program' ? programNoun : projectNoun}
                    {!item.direct ? ' · inherited' : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="bg-surface-container-low text-on-surface-variant rounded-xl px-4 py-6 text-center text-sm">
              No projects or programs linked to this yet.
            </p>
          )}
        </section>
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
