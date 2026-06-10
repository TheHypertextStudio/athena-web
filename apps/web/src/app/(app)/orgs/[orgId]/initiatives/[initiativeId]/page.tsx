'use client';

/**
 * The Initiative detail — a timeline-first roadmap rollup (mvp-plan §8.4).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/initiatives/[initiativeId]`. An Initiative is a
 * cross-cutting *theme* that contains no work itself; it associates many-to-many with Projects
 * and Programs. So the detail is **timeline-first**: the screen leads with a roadmap rollup of
 * the associated Projects (dated bars) with Programs rendered as always-on lanes
 * (`…/initiatives/:id/timeline`). The header status is **auto-derived** (there is no manual
 * status field to edit): a `derivedStatus` badge + the rolled-up (worst-child) health verdict +
 * a child-distribution bar showing how the associated children spread across the health buckets.
 *
 * A sidebar panel makes the m2m membership explicit and editable — the linked Programs/Projects
 * with unlink controls and styled "Link" pickers over the org's unlinked candidates. Any
 * link/unlink re-reads both the timeline (so the roadmap repositions) and the detail (so the
 * derived status + distribution update). Editing is gated to contributors (guests get a
 * read-only roadmap); the server enforces the capability regardless. Entity nouns route through
 * {@link useVocabulary}; data is fetched at runtime so the production build needs no server.
 */
import {
  ActorId,
  type InitiativeDetail,
  type InitiativeOut,
  type InitiativeTimelineOut,
  type InitiativeUpdate,
  type MemberOut,
  ProgramId,
  type ProgramOut,
  ProjectId,
  type ProjectOut,
  type RoleOut,
} from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Badge, Skeleton } from '@docket/ui/primitives';
import { ChevronLeft, Target } from '@docket/ui/icons';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/lib/auth-client';
import { api } from '@/lib/api';
import { type RpcResponse, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';
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

/** Roles that cannot contribute (read-only). Everyone else may link/unlink children. */
const READ_ONLY_ROLE_KEYS = new Set(['guest']);

/** The composite initiative-detail payload (the detail joined with link candidates + access info). */
interface InitiativeDetailData {
  readonly detail: InitiativeDetail;
  readonly allProjects: readonly ProjectOut[];
  readonly allPrograms: readonly ProgramOut[];
  readonly members: readonly MemberOut[];
  readonly roles: readonly RoleOut[];
}

/** The unbranded properties-panel patch surface. */
interface InitiativePatch {
  ownerId?: string | null;
  targetDate?: string | null;
}

/**
 * Build the branded initiative PATCH body from an {@link InitiativePatch}, omitting untouched
 * fields.
 *
 * @remarks
 * One branded body, reused for the optimistic cache snapshot AND the request. Returns the validated
 * {@link InitiativeUpdate} body, whose fields are a subset of {@link InitiativeDetail} so it can be
 * spread onto the cached detail without widening its branded fields.
 */
function toInitiativePatchBody(patch: InitiativePatch): InitiativeUpdate {
  return {
    ...(patch.ownerId !== undefined
      ? { ownerId: patch.ownerId === null ? null : ActorId.parse(patch.ownerId) }
      : {}),
    ...(patch.targetDate !== undefined ? { targetDate: patch.targetDate } : {}),
  };
}

/**
 * Build the composite initiative-detail fetcher, returning a {@link RpcResponse}-shaped result so
 * it can drive {@link useApiQuery} directly.
 *
 * @remarks
 * Composes the detail roll-up, the org's projects/programs (the link candidates), and the members/
 * roles (the access info) in parallel. The composite resolves `ok`/`status` from the gating detail
 * read; the candidate + access sub-reads degrade to empty lists.
 */
function fetchInitiativeDetail(
  orgId: string,
  initiativeId: string,
): () => Promise<RpcResponse<InitiativeDetailData>> {
  return async () => {
    const [detailRes, projectsRes, programsRes, membersRes, rolesRes] = await Promise.all([
      api.v1.orgs[':orgId'].initiatives[':id'].$get({ param: { orgId, id: initiativeId } }),
      api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
    ]);
    if (!detailRes.ok) {
      return {
        ok: false,
        status: detailRes.status,
        json: () => detailRes.json() as unknown as Promise<InitiativeDetailData>,
      };
    }
    const detail = await detailRes.json();
    const allProjects = projectsRes.ok ? (await projectsRes.json()).items : [];
    const allPrograms = programsRes.ok ? (await programsRes.json()).items : [];
    const members = membersRes.ok ? (await membersRes.json()).items : [];
    const roles = rolesRes.ok ? (await rolesRes.json()).items : [];
    return {
      ok: true,
      status: detailRes.status,
      json: () => Promise.resolve({ detail, allProjects, allPrograms, members, roles }),
    };
  };
}

/** Reduce a list of id/name entities to {@link AssociationItem} candidates, excluding linked ids. */
function candidatesOf(
  all: readonly { id: string; name: string }[],
  linkedIds: ReadonlySet<string>,
): readonly AssociationItem[] {
  return all
    .filter((item) => !linkedIds.has(item.id))
    .map((item) => ({ id: item.id, name: item.name }));
}

/**
 * The Initiative detail page.
 *
 * @returns the rendered roadmap-first detail.
 */
export default function InitiativeDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string; initiativeId: string }>();
  const { orgId, initiativeId } = params;
  const queryClient = useQueryClient();
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
  const loading = detailQ.isPending;
  const error = detailQ.isError ? detailQ.error.message : null;

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

  // Any link/unlink mutation re-reads both the timeline (so the roadmap repositions) and the
  // detail (so the derived status + distribution update). Both keys are invalidated on settle.
  const associationKeys = useMemo(
    () => [timelineKey, detailKey] as const,
    [timelineKey, detailKey],
  );

  /** Whether the caller may edit associations (contribute): everyone but a guest. */
  const canEdit = useMemo(() => {
    if (!userId) return false;
    const me = members.find((m) => m.userId === userId);
    if (!me?.roleId) return false;
    const myRole = roles.find((r) => r.id === me.roleId);
    return myRole ? !READ_ONLY_ROLE_KEYS.has(myRole.key) : false;
  }, [members, roles, userId]);

  /** The names of programs/projects currently on the timeline (the linked set). */
  const linkedPrograms = useMemo<readonly AssociationItem[]>(
    () => (timeline?.programs ?? []).map((lane) => ({ id: lane.id, name: lane.name })),
    [timeline],
  );
  // The timeline filters Project bars by date window; with no window the API returns every
  // associated Project, so the bars are the authoritative linked-Project set here.
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

  /** Link a Program, then re-read the roll-ups so the lane + distribution appear. */
  const linkProgramM = useApiMutation({
    mutationFn: (programId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives[':id'].programs.$post({
            param: { orgId, id: initiativeId },
            json: { programId: ProgramId.parse(programId) },
          }),
        `Could not link the ${programNounLower}.`,
      ),
    invalidateKeys: associationKeys,
  });

  /** Unlink a Program, then re-read the roll-ups. */
  const unlinkProgramM = useApiMutation({
    mutationFn: (programId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives[':id'].programs[':programId'].$delete({
            param: { orgId, id: initiativeId, programId },
          }),
        `Could not unlink the ${programNounLower}.`,
      ),
    invalidateKeys: associationKeys,
  });

  /** Link a Project, then re-read the roll-ups so the bar + distribution appear. */
  const linkProjectM = useApiMutation({
    mutationFn: (projectId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives[':id'].projects.$post({
            param: { orgId, id: initiativeId },
            json: { projectId: ProjectId.parse(projectId) },
          }),
        `Could not link the ${projectNounLower}.`,
      ),
    invalidateKeys: associationKeys,
  });

  /** Unlink a Project, then re-read the roll-ups. */
  const unlinkProjectM = useApiMutation({
    mutationFn: (projectId: string) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].initiatives[':id'].projects[':projectId'].$delete({
            param: { orgId, id: initiativeId, projectId },
          }),
        `Could not unlink the ${projectNounLower}.`,
      ),
    invalidateKeys: associationKeys,
  });

  const programBusy = linkProgramM.isPending || unlinkProgramM.isPending;
  const projectBusy = linkProjectM.isPending || unlinkProjectM.isPending;
  const programError = linkProgramM.error?.message ?? unlinkProgramM.error?.message ?? null;
  const projectError = linkProjectM.error?.message ?? unlinkProjectM.error?.message ?? null;

  /**
   * Optimistically patch the initiative's owner / target date: apply to the cached detail, fire the
   * PATCH, roll back on failure, and reconcile on settle. Editing an Initiative requires
   * `contribute` (gated by {@link canEdit}). The PATCH read-back is the base {@link InitiativeOut},
   * so success preserves the detail-only derived roll-up.
   */
  const patch = useApiMutation<InitiativeOut, InitiativePatch, { previous?: InitiativeDetailData }>(
    {
      mutationFn: (patchBody) =>
        unwrap(
          () =>
            api.v1.orgs[':orgId'].initiatives[':id'].$patch({
              param: { orgId, id: initiativeId },
              json: toInitiativePatchBody(patchBody),
            }),
          `Could not update the ${initiativeNounLower}.`,
        ),
      onMutate: async (patchBody) => {
        await queryClient.cancelQueries({ queryKey: detailKey });
        const body = toInitiativePatchBody(patchBody);
        const previous = queryClient.getQueryData<InitiativeDetailData>(detailKey);
        queryClient.setQueryData<InitiativeDetailData>(detailKey, (cur) =>
          cur ? { ...cur, detail: { ...cur.detail, ...body } } : cur,
        );
        return { previous };
      },
      onError: (_err, _body, ctx) => {
        if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
      },
      onSuccess: (updated) => {
        // Preserve the detail-only derived roll-up (childMix / distribution / rolledUpHealth /
        // derivedStatus); only the base fields come back from the PATCH.
        queryClient.setQueryData<InitiativeDetailData>(detailKey, (cur) =>
          cur
            ? {
                ...cur,
                detail: {
                  ...cur.detail,
                  ...updated,
                  childMix: cur.detail.childMix,
                  distribution: cur.detail.distribution,
                  rolledUpHealth: cur.detail.rolledUpHealth,
                  derivedStatus: cur.detail.derivedStatus,
                },
              }
            : cur,
        );
      },
      invalidateKeys: [detailKey],
    },
  );
  const patchInitiative = patch.mutate;
  const propsPending = patch.isPending;
  const propsError = patch.error?.message ?? null;

  const memberOptions = useMemo<readonly PickerOption[]>(
    () => memberActorOptions(members),
    [members],
  );

  if (loading) {
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

  if (error) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p
          role="alert"
          className="border-outline-variant text-destructive text-body rounded-lg border p-4"
        >
          {error}
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
              linkProgramM.mutate(id);
            }}
            onUnlinkProgram={(id) => {
              unlinkProgramM.mutate(id);
            }}
            onLinkProject={(id) => {
              linkProjectM.mutate(id);
            }}
            onUnlinkProject={(id) => {
              unlinkProjectM.mutate(id);
            }}
          />
        </aside>
      </div>
    </div>
  );
}
