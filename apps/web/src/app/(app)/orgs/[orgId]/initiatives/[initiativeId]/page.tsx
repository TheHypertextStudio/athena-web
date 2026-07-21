'use client';

import type {
  AttachmentOut,
  Health,
  InitiativePriority,
  InitiativeStatus,
  InitiativeUpdateCadence,
  UpdateOut,
} from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
import { ActorPicker, DatePicker, EnumPicker } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import {
  Activity,
  Calendar,
  ChevronLeft,
  CircleDot,
  Flag,
  RefreshCw,
  User,
} from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { type JSX, useEffect, useMemo, useState } from 'react';

import { EntityDocument } from '@/components/editor/entity-document';
import { memberActorOptions } from '@/components/property-pickers/options';
import { PropertyPanel, PropertyPanelRow } from '@/components/property-pickers/property-panel';
import { formatCalendarDate } from '@/lib/format-date';
import { UpdatesPanel } from '@/components/programs/updates-panel';
import { enumOptions, HEALTH_OPTIONS } from '@/components/pickers/options';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { initiativeDetailDef } from '@/lib/fetch-initiative-detail';
import { queryKeys, apiQueryOptions, useApiMutation, useApiQuery, unwrap } from '@/lib/query';
import { useInitiativeMutations } from '@/lib/use-initiative-mutations';
import { userErrorMessage } from '@/lib/problem';

const STATUS_LABEL: Record<InitiativeStatus, string> = {
  proposed: 'Proposed',
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
};
const PRIORITY_LABEL: Record<InitiativePriority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};
const CADENCE_LABEL: Record<InitiativeUpdateCadence, string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  none: 'None',
};
const STATUS_ORDER: readonly InitiativeStatus[] = ['proposed', 'active', 'completed', 'canceled'];
const PRIORITY_ORDER: readonly InitiativePriority[] = ['none', 'low', 'medium', 'high'];
const CADENCE_ORDER: readonly InitiativeUpdateCadence[] = [
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'none',
];

/** Printable, document-first Initiative detail. */
export default function InitiativeDetailPage(): JSX.Element {
  const { orgId, initiativeId } = useParams<{ orgId: string; initiativeId: string }>();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<'overview' | 'updates'>(
    searchParams.get('tab') === 'updates' ? 'updates' : 'overview',
  );
  const [resourceTitle, setResourceTitle] = useState('');
  const [resourceUrl, setResourceUrl] = useState('');
  const [editingHeader, setEditingHeader] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [summaryDraft, setSummaryDraft] = useState('');
  const initiativeNoun = useVocabulary('initiative');
  const initiativePlural = useVocabulary('initiative', { plural: true });
  const programNoun = useVocabulary('program');
  const projectNoun = useVocabulary('project');
  const { data: authSession } = useSession();
  const detailQ = useApiQuery(initiativeDetailDef(orgId, initiativeId));
  const data = detailQ.data;
  const detail = data?.detail;
  useEffect(() => {
    if (!detail || editingHeader) return;
    setTitleDraft(detail.name);
    setSummaryDraft(detail.summary ?? '');
  }, [detail, editingHeader]);

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

  const members = data?.members ?? [];
  const roles = data?.roles ?? [];
  const me = members.find((member) => member.userId === authSession?.user.id);
  const myRole = roles.find((role) => role.id === me?.roleId);
  const canEdit =
    myRole?.capabilities.some(
      (capability) => capability === 'contribute' || capability === 'manage',
    ) === true ||
    myRole?.baseCapability === 'contribute' ||
    myRole?.baseCapability === 'manage';
  const memberOptions = useMemo<readonly PickerOption[]>(
    () => memberActorOptions(members),
    [members],
  );
  const children = detail?.children ?? [];

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
    onSuccess: () => {
      setResourceTitle('');
      setResourceUrl('');
    },
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

  if (detailQ.isPending)
    return (
      <div className="mx-auto max-w-6xl space-y-5 p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  if (detailQ.isError || !detail)
    return (
      <p role="alert" className="text-destructive mx-auto max-w-6xl p-6">
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
    <main className="initiative-print mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
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
        <div className="flex items-center gap-2">
          {canEdit ? (
            <Button
              className="min-h-10"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditingHeader(true);
              }}
            >
              Edit
            </Button>
          ) : null}
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
      </div>

      <header className="max-w-4xl">
        <div className="mb-3">
          {editingHeader ? (
            <form
              className="no-print flex w-full max-w-3xl flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!titleDraft.trim()) return;
                mutations.patchInitiative({
                  name: titleDraft.trim(),
                  summary: summaryDraft.trim() || null,
                });
                setEditingHeader(false);
              }}
            >
              <input
                value={titleDraft}
                onChange={(event) => {
                  setTitleDraft(event.target.value);
                }}
                aria-label="Initiative title"
                className="border-outline-variant text-headline-large text-on-surface border-b bg-transparent outline-none"
              />
              <textarea
                value={summaryDraft}
                onChange={(event) => {
                  setSummaryDraft(event.target.value.slice(0, 280));
                }}
                aria-label="Initiative summary"
                placeholder="Add a concise strategic summary"
                rows={2}
                className="border-outline-variant text-on-surface-variant resize-none border-b bg-transparent text-lg outline-none"
              />
              <div className="flex gap-2">
                <Button size="sm" disabled={mutations.propsPending}>
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditingHeader(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
          <h1
            className={`${editingHeader ? 'print-only' : ''} text-headline-large text-on-surface`}
          >
            {detail.name}
          </h1>
        </div>
        {detail.summary ? (
          <p className="text-on-surface-variant max-w-3xl text-lg leading-relaxed">
            {detail.summary}
          </p>
        ) : null}
      </header>

      <section className="print-only border-outline-variant border-y py-4">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <PrintProperty label="Status" value={STATUS_LABEL[detail.status]} />
          <PrintProperty
            label="Initiative health"
            value={detail.health ? detail.health.replace('_', ' ') : '—'}
          />
          <PrintProperty
            label="Connected-work health"
            value={detail.rolledUpHealth ? detail.rolledUpHealth.replace('_', ' ') : '—'}
          />
          <PrintProperty label="Priority" value={PRIORITY_LABEL[detail.priority]} />
          <PrintProperty label="Owner" value={ownerName} />
          <PrintProperty
            label="Target"
            value={detail.targetDate ? detail.targetDate.slice(0, 10) : '—'}
          />
          <PrintProperty label="Update cadence" value={CADENCE_LABEL[detail.updateCadence]} />
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

      <div
        className="no-print border-outline-variant flex gap-5 border-b"
        role="tablist"
        aria-label="Initiative sections"
      >
        {(['overview', 'updates'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={
              tab === value
                ? 'border-primary text-on-surface min-h-10 border-b-2 text-sm font-medium'
                : 'text-on-surface-variant min-h-10 text-sm'
            }
            onClick={() => {
              setTab(value);
            }}
          >
            {value === 'overview'
              ? 'Overview'
              : `Updates${updates.length ? ` ${updates.length}` : ''}`}
          </button>
        ))}
      </div>

      {tab === 'updates' ? (
        <div className="no-print">
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
          />
        </div>
      ) : null}
      <div
        className={`${tab === 'overview' ? 'grid' : 'hidden'} initiative-overview min-w-0 gap-10 @5xl:grid-cols-[minmax(0,1fr)_18rem]`}
      >
        <div className="min-w-0 space-y-10">
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
                      {STATUS_LABEL[child.status]}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="bg-surface-container-low text-on-surface-variant rounded-xl px-4 py-6 text-center text-sm">
                No sub-initiatives in this workspace context.
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
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm"
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
                No connected work yet.
              </p>
            )}
          </section>
        </div>
        <aside className="initiative-properties flex flex-col gap-4">
          <PropertyPanel>
            <PropertyPanelRow icon={<User className="size-4" />} label="Owner">
              <ActorPicker
                options={memberOptions}
                value={detail.ownerId ?? null}
                onChange={(ownerId) => {
                  mutations.patchInitiative({ ownerId });
                }}
                placeholder="Set owner"
                clearLabel="No owner"
                ariaLabel="Owner"
                readOnly={!canEdit}
                disabled={mutations.propsPending}
              />
            </PropertyPanelRow>
            <PropertyPanelRow divided icon={<Calendar className="size-4" />} label="Target date">
              <DatePicker
                value={detail.targetDate ? detail.targetDate.slice(0, 10) : null}
                onChange={(targetDate) => {
                  mutations.patchInitiative({ targetDate });
                }}
                placeholder="Set target date"
                formatLabel={(value) => formatCalendarDate(value) ?? undefined}
                ariaLabel="Target date"
                readOnly={!canEdit}
                disabled={mutations.propsPending}
              />
            </PropertyPanelRow>
            <PropertyPanelRow divided icon={<CircleDot className="size-4" />} label="Status">
              <EnumPicker
                options={enumOptions(STATUS_ORDER, STATUS_LABEL)}
                value={detail.status}
                onChange={(status) => {
                  if (status) mutations.patchInitiative({ status });
                }}
                ariaLabel="Status"
                placeholder="Choose status"
                readOnly={!canEdit}
              />
            </PropertyPanelRow>
            <PropertyPanelRow
              divided
              icon={<Activity className="size-4" />}
              label={`${initiativeNoun} health`}
            >
              <EnumPicker
                options={HEALTH_OPTIONS}
                value={detail.health ?? null}
                onChange={(health) => {
                  mutations.patchInitiative({ health });
                }}
                ariaLabel="Initiative health"
                placeholder="No health"
                readOnly={!canEdit}
                clearLabel="No health"
              />
            </PropertyPanelRow>
            <PropertyPanelRow
              divided
              icon={<Activity className="size-4" />}
              label="Connected-work health"
            >
              <span className="capitalize">
                {detail.rolledUpHealth ? detail.rolledUpHealth.replace('_', ' ') : '—'}
              </span>
            </PropertyPanelRow>
            <PropertyPanelRow divided icon={<Flag className="size-4" />} label="Priority">
              <EnumPicker
                options={enumOptions(PRIORITY_ORDER, PRIORITY_LABEL)}
                value={detail.priority}
                onChange={(priority) => {
                  if (priority) mutations.patchInitiative({ priority });
                }}
                ariaLabel="Priority"
                placeholder="Choose priority"
                readOnly={!canEdit}
              />
            </PropertyPanelRow>
            <PropertyPanelRow
              divided
              icon={<RefreshCw className="size-4" />}
              label="Update cadence"
            >
              <EnumPicker
                options={enumOptions(CADENCE_ORDER, CADENCE_LABEL)}
                value={detail.updateCadence}
                onChange={(updateCadence) => {
                  if (updateCadence) mutations.patchInitiative({ updateCadence });
                }}
                ariaLabel="Update cadence"
                placeholder="Choose cadence"
                readOnly={!canEdit}
              />
            </PropertyPanelRow>
          </PropertyPanel>
          <section className="bg-surface-container-low flex flex-col gap-3 rounded-xl px-4 py-3">
            <h3 className="text-on-surface-variant text-xs font-medium">Labels</h3>
            <div className="flex flex-wrap gap-2">
              {data.labels
                .filter((label) => label.teamId === null || label.teamId === undefined)
                .map((label) => {
                  const selected = detail.labels.some((attached) => attached.id === label.id);
                  return (
                    <button
                      key={label.id}
                      type="button"
                      disabled={!canEdit || mutations.propsPending}
                      aria-pressed={selected}
                      onClick={() => {
                        mutations.patchInitiative({
                          labelIds: selected
                            ? detail.labels
                                .filter((attached) => attached.id !== label.id)
                                .map((attached) => attached.id)
                            : [...detail.labels.map((attached) => attached.id), label.id],
                        });
                      }}
                      className={`min-h-10 rounded-full border px-3 py-1 text-xs ${
                        selected
                          ? 'border-primary text-on-surface'
                          : 'border-outline-variant text-on-surface-variant'
                      }`}
                    >
                      {label.name}
                    </button>
                  );
                })}
              {data.labels.filter((label) => label.teamId === null || label.teamId === undefined)
                .length === 0 ? (
                <span className="text-on-surface-variant text-xs">No workspace labels.</span>
              ) : null}
            </div>
          </section>
          <section className="bg-surface-container-low flex flex-col gap-3 rounded-xl px-4 py-3">
            <h3 className="text-on-surface-variant text-xs font-medium">Resources</h3>
            {detail.resources.length ? (
              <div className="flex flex-col gap-1">
                {detail.resources.map((resource) => (
                  <div key={resource.id} className="flex items-center gap-2 text-sm">
                    <a
                      href={resource.url ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {resource.title}
                    </a>
                    {canEdit ? (
                      <button
                        type="button"
                        className="text-on-surface-variant hover:text-destructive min-h-10 text-xs"
                        onClick={() => {
                          removeResource.mutate(resource.id);
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-on-surface-variant text-xs">No resources yet.</p>
            )}
            {canEdit ? (
              <form
                className="no-print space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (resourceTitle.trim() && resourceUrl.trim()) {
                    addResource.mutate({
                      title: resourceTitle.trim(),
                      url: resourceUrl.trim(),
                    });
                  }
                }}
              >
                <input
                  value={resourceTitle}
                  onChange={(event) => {
                    setResourceTitle(event.target.value);
                  }}
                  placeholder="Resource title"
                  className="border-input bg-background h-10 w-full rounded-md border px-2 text-xs"
                />
                <input
                  value={resourceUrl}
                  onChange={(event) => {
                    setResourceUrl(event.target.value);
                  }}
                  placeholder="https://…"
                  type="url"
                  className="border-input bg-background h-10 w-full rounded-md border px-2 text-xs"
                />
                <Button
                  className="min-h-10"
                  size="sm"
                  variant="outline"
                  disabled={addResource.isPending}
                >
                  Add resource
                </Button>
              </form>
            ) : null}
            {addResource.error || removeResource.error ? (
              <p role="alert" className="text-destructive text-xs">
                {userErrorMessage(
                  addResource.error ?? removeResource.error,
                  'Could not change resources.',
                )}
              </p>
            ) : null}
          </section>
          {mutations.propsError ? (
            <p role="alert" className="text-destructive text-sm">
              {mutations.propsError}
            </p>
          ) : null}
        </aside>
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
          nav:not(.entity-contents),
          aside {
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
            display: grid !important;
          }
          .entity-document button {
            border: 0 !important;
            padding: 0 !important;
          }
        }
      `}</style>
    </main>
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
