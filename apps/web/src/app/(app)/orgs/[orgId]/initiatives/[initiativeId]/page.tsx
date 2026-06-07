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
  type InitiativeDetail,
  type InitiativeTimelineOut,
  type MemberOut,
  ProgramId,
  type ProgramOut,
  ProjectId,
  type ProjectOut,
  type RoleOut,
} from '@docket/types';
import { useVocabulary } from '@docket/ui/hooks';
import { Badge, Skeleton } from '@docket/ui/primitives';
import { ChevronLeft, Target } from '@docket/ui/icons';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { useSession } from '@/lib/auth-client';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
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
import { Roadmap } from '@/components/initiatives/roadmap';

/** Roles that cannot contribute (read-only). Everyone else may link/unlink children. */
const READ_ONLY_ROLE_KEYS = new Set(['guest']);

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

  const [detail, setDetail] = useState<InitiativeDetail | null>(null);
  const [timeline, setTimeline] = useState<InitiativeTimelineOut | null>(null);
  const [allProjects, setAllProjects] = useState<readonly ProjectOut[]>([]);
  const [allPrograms, setAllPrograms] = useState<readonly ProgramOut[]>([]);
  const [members, setMembers] = useState<readonly MemberOut[]>([]);
  const [roles, setRoles] = useState<readonly RoleOut[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [programBusy, setProgramBusy] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const [programError, setProgramError] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);

  /** Re-read the derived roll-up (`derivedStatus` / `rolledUpHealth` / `distribution`). */
  const refreshDetail = useCallback(async (): Promise<void> => {
    const res = await api.v1.orgs[':orgId'].initiatives[':id'].$get({
      param: { orgId, id: initiativeId },
    });
    if (res.ok) setDetail(await res.json());
  }, [orgId, initiativeId]);

  /** Re-read the timeline roll-up (Program lanes + Project bars). */
  const refreshTimeline = useCallback(async (): Promise<void> => {
    const res = await api.v1.orgs[':orgId'].initiatives[':id'].timeline.$get({
      param: { orgId, id: initiativeId },
      query: {},
    });
    if (res.ok) setTimeline(await res.json());
  }, [orgId, initiativeId]);

  /** Load the detail roll-up, the timeline, the org's projects/programs, and access info. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [detailRes, timelineRes, projectsRes, programsRes, membersRes, rolesRes] =
        await Promise.all([
          api.v1.orgs[':orgId'].initiatives[':id'].$get({ param: { orgId, id: initiativeId } }),
          api.v1.orgs[':orgId'].initiatives[':id'].timeline.$get({
            param: { orgId, id: initiativeId },
            query: {},
          }),
          api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
          api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
        ]);

      if (!detailRes.ok) {
        setError(await readProblem(detailRes, `Could not load this ${initiativeNounLower}.`));
        return;
      }
      setDetail(await detailRes.json());
      if (timelineRes.ok) setTimeline(await timelineRes.json());
      if (projectsRes.ok) setAllProjects((await projectsRes.json()).items);
      if (programsRes.ok) setAllPrograms((await programsRes.json()).items);
      if (membersRes.ok) setMembers((await membersRes.json()).items);
      if (rolesRes.ok) setRoles((await rolesRes.json()).items);
    } catch (caught) {
      setError(readError(caught, `Something went wrong loading this ${initiativeNounLower}.`));
    } finally {
      setLoading(false);
    }
  }, [orgId, initiativeId, initiativeNounLower]);

  useEffect(() => {
    void load();
  }, [load]);

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
  const linkProgram = useCallback(
    async (programId: string): Promise<void> => {
      setProgramBusy(true);
      setProgramError(null);
      try {
        const res = await api.v1.orgs[':orgId'].initiatives[':id'].programs.$post({
          param: { orgId, id: initiativeId },
          json: { programId: ProgramId.parse(programId) },
        });
        if (!res.ok) {
          setProgramError(await readProblem(res, `Could not link the ${programNounLower}.`));
          return;
        }
        await Promise.all([refreshTimeline(), refreshDetail()]);
      } catch (caught) {
        setProgramError(readError(caught, `Something went wrong linking the ${programNounLower}.`));
      } finally {
        setProgramBusy(false);
      }
    },
    [orgId, initiativeId, programNounLower, refreshTimeline, refreshDetail],
  );

  /** Unlink a Program, then re-read the roll-ups. */
  const unlinkProgram = useCallback(
    async (programId: string): Promise<void> => {
      setProgramBusy(true);
      setProgramError(null);
      try {
        const res = await api.v1.orgs[':orgId'].initiatives[':id'].programs[':programId'].$delete({
          param: { orgId, id: initiativeId, programId },
        });
        if (!res.ok) {
          setProgramError(await readProblem(res, `Could not unlink the ${programNounLower}.`));
          return;
        }
        await Promise.all([refreshTimeline(), refreshDetail()]);
      } catch (caught) {
        setProgramError(
          readError(caught, `Something went wrong unlinking the ${programNounLower}.`),
        );
      } finally {
        setProgramBusy(false);
      }
    },
    [orgId, initiativeId, programNounLower, refreshTimeline, refreshDetail],
  );

  /** Link a Project, then re-read the roll-ups so the bar + distribution appear. */
  const linkProject = useCallback(
    async (projectId: string): Promise<void> => {
      setProjectBusy(true);
      setProjectError(null);
      try {
        const res = await api.v1.orgs[':orgId'].initiatives[':id'].projects.$post({
          param: { orgId, id: initiativeId },
          json: { projectId: ProjectId.parse(projectId) },
        });
        if (!res.ok) {
          setProjectError(await readProblem(res, `Could not link the ${projectNounLower}.`));
          return;
        }
        await Promise.all([refreshTimeline(), refreshDetail()]);
      } catch (caught) {
        setProjectError(readError(caught, `Something went wrong linking the ${projectNounLower}.`));
      } finally {
        setProjectBusy(false);
      }
    },
    [orgId, initiativeId, projectNounLower, refreshTimeline, refreshDetail],
  );

  /** Unlink a Project, then re-read the roll-ups. */
  const unlinkProject = useCallback(
    async (projectId: string): Promise<void> => {
      setProjectBusy(true);
      setProjectError(null);
      try {
        const res = await api.v1.orgs[':orgId'].initiatives[':id'].projects[':projectId'].$delete({
          param: { orgId, id: initiativeId, projectId },
        });
        if (!res.ok) {
          setProjectError(await readProblem(res, `Could not unlink the ${projectNounLower}.`));
          return;
        }
        await Promise.all([refreshTimeline(), refreshDetail()]);
      } catch (caught) {
        setProjectError(
          readError(caught, `Something went wrong unlinking the ${projectNounLower}.`),
        );
      } finally {
        setProjectBusy(false);
      }
    },
    [orgId, initiativeId, projectNounLower, refreshTimeline, refreshDetail],
  );

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_18rem]">
          <Skeleton className="h-80 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-5xl p-8">
        <p role="alert" className="border-border text-destructive rounded-lg border p-4 text-sm">
          {error}
        </p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto w-full max-w-5xl p-8">
        <p className="border-border text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          This {initiativeNounLower} could not be found.
        </p>
      </div>
    );
  }

  const targetDateLabel = formatDate(detail.targetDate ?? null);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <button
        type="button"
        onClick={() => {
          router.push(`/orgs/${orgId}/initiatives`);
        }}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -ml-1 inline-flex w-fit items-center gap-1 rounded text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        All {initiativeNounPlural.toLowerCase()}
      </button>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Target aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
          <h1 className="text-2xl font-semibold tracking-tight">{detail.name}</h1>
          <Badge variant={derivedStatusVariant(detail.derivedStatus)}>
            {DERIVED_STATUS_LABEL[detail.derivedStatus]}
          </Badge>
          <RolledUpHealthPill health={detail.rolledUpHealth} />
        </div>
        {detail.description ? (
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
            {detail.description}
          </p>
        ) : null}
        {targetDateLabel ? (
          <p className="text-muted-foreground text-xs">Target — {targetDateLabel}</p>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section
            aria-label="Health rollup"
            className="border-border bg-card flex flex-col gap-3 rounded-xl border p-5"
          >
            <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Rolled-up health
            </h2>
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
              void linkProgram(id);
            }}
            onUnlinkProgram={(id) => {
              void unlinkProgram(id);
            }}
            onLinkProject={(id) => {
              void linkProject(id);
            }}
            onUnlinkProject={(id) => {
              void unlinkProject(id);
            }}
          />
        </aside>
      </div>
    </div>
  );
}
