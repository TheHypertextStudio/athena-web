'use client';

import type { InitiativeTimelineOut } from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Badge, Skeleton } from '@docket/ui/primitives';
import { ChevronLeft, Target } from '@docket/ui/icons';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useMemo } from 'react';

import { useSession } from '@/lib/auth-client';
import { api } from '@/lib/api';
import { queryKeys, useApiQuery } from '@/lib/query';
import { memberActorOptions } from '@/components/property-pickers/options';
import {
  AssociationsPanel,
  type AssociationItem,
} from '@/components/initiatives/associations-panel';
import {
  DERIVED_STATUS_LABEL,
  derivedStatusVariant,
} from '@/components/initiatives/derived-status';
import { DistributionBar } from '@/components/initiatives/distribution-bar';
import { formatDate } from '@/components/initiatives/format-date';
import { RolledUpHealthPill } from '@/components/initiatives/health-pill';
import { InitiativePropertiesPanel } from '@/components/initiatives/properties-panel';
import { Roadmap } from '@/components/initiatives/roadmap';
import { fetchInitiativeDetail } from '@/lib/fetch-initiative-detail';
import { useInitiativeMutations } from '@/lib/use-initiative-mutations';

const READ_ONLY_ROLE_KEYS = new Set(['guest']);

function candidatesOf(
  all: readonly { id: string; name: string }[],
  linkedIds: ReadonlySet<string>,
): readonly AssociationItem[] {
  return all
    .filter((item) => !linkedIds.has(item.id))
    .map((item) => ({ id: item.id, name: item.name }));
}

export default function InitiativeDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string; initiativeId: string }>();
  const { orgId, initiativeId } = params;
  const { data: authSession } = useSession();
  const userId = authSession?.user.id ?? null;

  const initiativeNoun = useVocabulary('initiative');
  const initiativeNounLower = initiativeNoun.toLowerCase();
  const initiativeNounPlural = useVocabulary('initiative', { plural: true });
  const programNoun = useVocabulary('program');
  const programNounLower = programNoun.toLowerCase();
  const programNounPlural = useVocabulary('program', { plural: true });
  const projectNoun = useVocabulary('project');
  const projectNounLower = projectNoun.toLowerCase();
  const projectNounPlural = useVocabulary('project', { plural: true });

  const detailKey = queryKeys.initiative(orgId, initiativeId);
  const timelineKey = useMemo(() => [...detailKey, 'timeline'] as const, [detailKey]);

  const detailQ = useApiQuery(
    detailKey,
    fetchInitiativeDetail(orgId, initiativeId),
    `Could not load this ${initiativeNounLower}.`,
  );
  const data = detailQ.data ?? null;
  const detail = data?.detail ?? null;
  const allProjects = data?.allProjects ?? [];
  const allPrograms = data?.allPrograms ?? [];
  const members = data?.members ?? [];
  const roles = data?.roles ?? [];

  const timelineQ = useApiQuery(
    timelineKey,
    () =>
      api.v1.orgs[':orgId'].initiatives[':id'].timeline.$get({
        param: { orgId, id: initiativeId },
        query: {},
      }),
    'Could not load the timeline.',
  );
  const timeline: InitiativeTimelineOut | null = timelineQ.data ?? null;

  const {
    patchInitiative,
    propsPending,
    propsError,
    linkProgram,
    unlinkProgram,
    linkProject,
    unlinkProject,
    programBusy,
    projectBusy,
    programError,
    projectError,
  } = useInitiativeMutations(
    orgId,
    initiativeId,
    initiativeNounLower,
    programNounLower,
    projectNounLower,
  );

  const canEdit = useMemo(() => {
    if (!userId) return false;
    const me = members.find((m) => m.userId === userId);
    if (!me?.roleId) return false;
    const myRole = roles.find((r) => r.id === me.roleId);
    return myRole ? !READ_ONLY_ROLE_KEYS.has(myRole.key) : false;
  }, [members, roles, userId]);

  const linkedPrograms = useMemo<readonly AssociationItem[]>(
    () => (timeline?.programs ?? []).map((lane) => ({ id: lane.id, name: lane.name })),
    [timeline],
  );
  const linkedProjects = useMemo<readonly AssociationItem[]>(
    () => (timeline?.projects ?? []).map((bar) => ({ id: bar.id, name: bar.name })),
    [timeline],
  );
  const programCandidates = useMemo(
    () => candidatesOf(allPrograms, new Set(linkedPrograms.map((p) => p.id))),
    [allPrograms, linkedPrograms],
  );
  const projectCandidates = useMemo(
    () => candidatesOf(allProjects, new Set(linkedProjects.map((p) => p.id))),
    [allProjects, linkedProjects],
  );

  const memberOptions = useMemo<readonly PickerOption[]>(
    () => memberActorOptions(members),
    [members],
  );

  if (detailQ.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
          <Skeleton className="h-80 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (detailQ.isError) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p
          role="alert"
          className="border-outline-variant text-destructive text-body rounded-lg border p-4"
        >
          {detailQ.error.message}
        </p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p className="border-outline-variant text-on-surface-variant text-body rounded-xl border border-dashed p-8 text-center">
          This {initiativeNounLower} could not be found.
        </p>
      </div>
    );
  }

  const targetDateLabel = formatDate(detail.targetDate ?? null);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <button
        type="button"
        onClick={() => {
          router.push(`/orgs/${orgId}/initiatives`);
        }}
        className="text-on-surface-variant hover:text-on-surface focus-visible:ring-ring text-body -ml-1 inline-flex w-fit items-center gap-1 rounded transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        All {initiativeNounPlural.toLowerCase()}
      </button>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Target aria-hidden="true" className="text-on-surface-variant size-5 shrink-0" />
          <h1 className="text-on-surface text-h1">{detail.name}</h1>
          <Badge variant={derivedStatusVariant(detail.derivedStatus)}>
            {DERIVED_STATUS_LABEL[detail.derivedStatus]}
          </Badge>
          <RolledUpHealthPill health={detail.rolledUpHealth} />
        </div>
        {detail.description ? (
          <p className="text-on-surface-variant text-body max-w-2xl leading-relaxed">
            {detail.description}
          </p>
        ) : null}
        {targetDateLabel ? (
          <p className="text-on-surface-variant text-xs">Target — {targetDateLabel}</p>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section
            aria-label="Health rollup"
            className="border-outline-variant bg-surface-container-low flex flex-col gap-3 rounded-xl border p-4"
          >
            <h2 className="text-on-surface-variant text-xs font-medium">Rolled-up health</h2>
            <DistributionBar
              distribution={detail.distribution}
              childNounPlural={`${projectNounPlural.toLowerCase()} & ${programNounPlural.toLowerCase()}`}
            />
          </section>

          <Roadmap
            lanes={timeline?.programs ?? []}
            bars={timeline?.projects ?? []}
            targetDate={detail.targetDate ?? null}
            programNoun={programNoun}
            projectNoun={projectNoun}
            projectNounPlural={projectNounPlural}
            onOpenProject={(projectId) => {
              router.push(`/orgs/${orgId}/projects/${projectId}`);
            }}
          />
        </div>

        <aside className="flex flex-col gap-4">
          <InitiativePropertiesPanel
            ownerId={detail.ownerId ?? null}
            memberOptions={memberOptions}
            targetDate={detail.targetDate ? detail.targetDate.slice(0, 10) : null}
            canEdit={canEdit}
            pending={propsPending}
            onOwnerChange={(ownerId) => {
              patchInitiative({ ownerId });
            }}
            onTargetDateChange={(targetDate) => {
              patchInitiative({ targetDate });
            }}
          />
          {propsError ? (
            <p role="alert" className="text-destructive text-body px-1">
              {propsError}
            </p>
          ) : null}

          <AssociationsPanel
            programNounPlural={programNounPlural}
            programNoun={programNounLower}
            projectNounPlural={projectNounPlural}
            projectNoun={projectNounLower}
            linkedPrograms={linkedPrograms}
            programCandidates={programCandidates}
            linkedProjects={linkedProjects}
            projectCandidates={projectCandidates}
            canEdit={canEdit}
            programBusy={programBusy}
            projectBusy={projectBusy}
            programError={programError}
            projectError={projectError}
            onLinkProgram={(id) => {
              linkProgram(id);
            }}
            onUnlinkProgram={(id) => {
              unlinkProgram(id);
            }}
            onLinkProject={(id) => {
              linkProject(id);
            }}
            onUnlinkProject={(id) => {
              unlinkProject(id);
            }}
          />
        </aside>
      </div>
    </div>
  );
}
