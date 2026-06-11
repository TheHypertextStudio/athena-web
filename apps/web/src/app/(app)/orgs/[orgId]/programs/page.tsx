'use client';

import type { ProgramOut } from '@docket/types';
import { EmptyState, StatusIcon } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Layers, Plus } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';

import { type ProgramRow, ListSkeleton, ProgramRows } from '@/components/programs/program-list-ui';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { CreateProgramDialog } from '@/components/programs/create-program';
import { buildProgramCatalog } from '@/components/programs/program-catalog';
import { statusGlyphType } from '@/components/programs/program-status';
import { applyView, EMPTY_GROUP_ID } from '@/components/views/apply-view';
import type { FieldOption } from '@/components/views/field-catalog';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { useViewState } from '@/components/views/use-view-state';
import { api } from '@/lib/api';
import { queryKeys, useApiQuery } from '@/lib/query';

/**
 * The org Programs list — the roster of ongoing operational lines of work (§8.4), as dense rows.
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/programs`. Programs are *ongoing*, so each
 * {@link EntityListRow} leads with a liveness status glyph and surfaces the program's owner,
 * its child-work scope ("N projects" + "M tasks"), and — in the trailing slot — its
 * {@link HealthDot | health} and lifecycle {@link ProgramStatusBadge}. The former card grid is
 * replaced by one clean bordered list of hairline-divided rows (design-system §5.1).
 *
 * It composes four slices through the dynamic-data layer — programs, projects, tasks, and
 * members — so each stays live (auto-refetch on focus + after a create) without a manual refresh
 * control, and rolls up the per-program scope client-side (a project belongs to a program via
 * `project.programId`; a task belongs via `task.programId` directly or through one of those
 * projects) so the roster renders without an N-round-trip detail fan-out. Members name each
 * program's owner.
 *
 * Filtering is the unified engine: a single {@link FilterToolbar} over the program
 * {@link buildProgramCatalog | catalog} replaces the old bespoke status menu, so the roster can
 * be filtered by status / health / owner, grouped, and sorted — all applied **client-side** over
 * the already-loaded {@link useApiQuery} results (Phase B data flow is preserved; no manual
 * refresh). The view state is held in the URL by {@link useViewState}, so a filtered roster is
 * shareable and survives a reload. Entity nouns route through {@link useVocabulary}; data is
 * fetched at runtime so the production build needs no running server.
 */
export default function ProgramsListPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const queryClient = useQueryClient();

  const programLabel = useVocabulary('program');
  const programsLabel = useVocabulary('program', { plural: true });
  const projectNoun = useVocabulary('project').toLowerCase();
  const projectNounPlural = useVocabulary('project', { plural: true }).toLowerCase();
  const taskNoun = useVocabulary('task').toLowerCase();
  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();

  const [createOpen, setCreateOpen] = useState(false);
  const { state, setFilters, setGroupBy, setSort } = useViewState();

  // The roster is the primary slice (its load gates the page); projects, tasks, and members
  // enrich each row and degrade gracefully (an empty list) if they fail, mirroring the prior
  // behavior. Each stays live without a manual refresh.
  const programsQ = useApiQuery(
    queryKeys.programs(orgId),
    () => api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
    `Could not load ${programsLabel.toLowerCase()}.`,
  );
  const projectsQ = useApiQuery(
    queryKeys.projects(orgId),
    () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
    'Could not load projects.',
  );
  const tasksQ = useApiQuery(
    queryKeys.tasks(orgId),
    () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId } }),
    'Could not load tasks.',
  );
  const membersQ = useApiQuery(
    queryKeys.members(orgId),
    () => api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
    'Could not load members.',
  );

  const programs = useMemo(() => programsQ.data?.items ?? [], [programsQ.data]);
  const projects = useMemo(() => projectsQ.data?.items ?? [], [projectsQ.data]);
  const tasks = useMemo(() => tasksQ.data?.items ?? [], [tasksQ.data]);
  const members = useMemo(() => membersQ.data?.items ?? [], [membersQ.data]);

  const loading = programsQ.isPending;
  const loadError = programsQ.isError ? programsQ.error.message : null;

  /** Owner display name by actor id (for the row attribution + filter labels). */
  const ownerNameById = useMemo(
    () => new Map<string, string>(members.map((m) => [m.actorId, m.displayName])),
    [members],
  );

  /** The program id each project belongs to, indexed for the task roll-up below. */
  const programByProjectId = useMemo(
    () => new Map(projects.map((p) => [p.id, p.programId ?? null])),
    [projects],
  );

  /** Per-program project counts (a project belongs via `project.programId`). */
  const projectCountByProgram = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects) {
      if (project.programId)
        counts.set(project.programId, (counts.get(project.programId) ?? 0) + 1);
    }
    return counts;
  }, [projects]);

  /**
   * Per-program task counts: a task belongs to a program when it carries the program
   * directly (`task.programId`) or via the project it sits in (`project.programId`),
   * matching the API's `…/programs/:id/work` roll-up rule.
   */
  const taskCountByProgram = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const programId =
        task.programId ?? (task.projectId ? programByProjectId.get(task.projectId) : null);
      if (programId) counts.set(programId, (counts.get(programId) ?? 0) + 1);
    }
    return counts;
  }, [tasks, programByProjectId]);

  /** The program field catalog driving the toolbar + the apply engine. */
  const catalog = useMemo(
    () =>
      buildProgramCatalog({
        ownerLabel: 'Owner',
        ownerOptions: (): readonly FieldOption[] =>
          members.map((m) => ({ value: m.actorId, label: m.displayName })),
        resolveOwner: (id) => ownerNameById.get(id) ?? id,
      }),
    [members, ownerNameById],
  );

  /** Filter + sort + group the loaded roster client-side per the active view state. */
  const applied = useMemo(() => applyView(programs, state, catalog), [programs, state, catalog]);

  /** Adapt a program to its dense-row view-model. */
  const toRow = useCallback(
    (program: ProgramOut): ProgramRow => ({
      program,
      ownerName: program.ownerId ? (ownerNameById.get(program.ownerId) ?? null) : null,
      projectCount: projectCountByProgram.get(program.id) ?? 0,
      taskCount: taskCountByProgram.get(program.id) ?? 0,
    }),
    [ownerNameById, projectCountByProgram, taskCountByProgram],
  );

  /**
   * Refetch the roster from the server (prefix-matched, so this also refreshes any open
   * program-detail beneath it), then open the freshly-created program's detail.
   */
  const handleCreated = useCallback(
    (created: ProgramOut): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.programs(orgId) });
      router.push(`/orgs/${orgId}/programs/${created.id}`);
    },
    [orgId, router, queryClient],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-on-surface text-h1">{programsLabel}</h1>
          <p className="text-on-surface-variant text-xs">
            Ongoing lines of work — tracked by health, not a finish line.
          </p>
        </div>
        <Button
          type="button"
          className="gap-1.5"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          <Plus aria-hidden="true" className="size-4" />
          New {programLabel}
        </Button>
      </header>

      <CreateProgramDialog
        orgId={orgId}
        programNoun={programLabel}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      {!loading && !loadError && programs.length > 0 ? (
        <FilterToolbar
          catalog={catalog}
          state={state}
          onFiltersChange={setFilters}
          onGroupByChange={setGroupBy}
          onSortChange={setSort}
        />
      ) : null}

      {loading ? (
        <ListSkeleton />
      ) : loadError ? (
        <p
          role="alert"
          className="border-outline-variant text-destructive text-body rounded-xl border p-4"
        >
          {loadError}
        </p>
      ) : programs.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={`No ${programsLabel.toLowerCase()} yet`}
          body={`${programsLabel} are ongoing lines of work — your funded areas, retainers, or recurring operations. Create one to start tracking its health.`}
          cta={{
            label: `Create your first ${programLabel.toLowerCase()}`,
            onClick: () => {
              setCreateOpen(true);
            },
          }}
        />
      ) : applied.rows.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={`No matching ${programsLabel.toLowerCase()}`}
          body={`No ${programLabel.toLowerCase()} matches the active filters. Adjust or clear them to see more.`}
        />
      ) : applied.groups ? (
        <div className="flex flex-col gap-4">
          {applied.groups.map((group) => (
            <section key={group.id} className="flex flex-col gap-2">
              <h2 className="text-on-surface-variant flex items-center gap-2 px-1 text-xs font-medium">
                {state.groupBy?.field === 'status' && group.id !== EMPTY_GROUP_ID ? (
                  <StatusIcon
                    type={statusGlyphType(group.id as ProgramOut['status'])}
                    label={group.label}
                  />
                ) : null}
                <span>{group.label}</span>
                <span className="text-on-surface-variant/70 tabular-nums">{group.rows.length}</span>
              </h2>
              <ProgramRows
                rows={group.rows.map(toRow)}
                projectNoun={projectNoun}
                projectNounPlural={projectNounPlural}
                taskNoun={taskNoun}
                taskNounPlural={taskNounPlural}
                ariaLabel={`${programsLabel} — ${group.label}`}
                onOpen={(id) => {
                  router.push(`/orgs/${orgId}/programs/${id}`);
                }}
              />
            </section>
          ))}
        </div>
      ) : (
        <ProgramRows
          rows={applied.rows.map(toRow)}
          projectNoun={projectNoun}
          projectNounPlural={projectNounPlural}
          taskNoun={taskNoun}
          taskNounPlural={taskNounPlural}
          ariaLabel={programsLabel}
          onOpen={(id) => {
            router.push(`/orgs/${orgId}/programs/${id}`);
          }}
        />
      )}
    </div>
  );
}
