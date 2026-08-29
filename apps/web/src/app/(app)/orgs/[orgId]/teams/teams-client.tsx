'use client';

import type { EntityDisplayOut, TeamOut } from '@docket/types';
import { defaultEntityDisplay } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { LayoutGrid, ListView, Plus, Users } from '@docket/ui/icons';
import {
  Button,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@docket/ui/primitives';
import { type JSX, useCallback, useMemo } from 'react';

import { useCreateObject } from '@/components/create-object/create-object-provider';
import { type TeamCardMember, TeamCard, TeamCardsSkeleton } from '@/components/teams/team-card';
import { buildTeamCatalog } from '@/components/teams/team-catalog';
import { type TeamRow, ListSkeleton, TeamRows } from '@/components/teams/team-list-ui';
import { applyView } from '@/components/views/apply-view';
import { FilterToolbar } from '@/components/views/filter-toolbar';
import { type LayoutMode, useLayoutMode } from '@/components/views/use-layout-mode';
import { useViewState } from '@/components/views/use-view-state';
import { api } from '@/lib/api';
import { useTypedRoute } from '@/lib/app-location';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';

/**
 * The org Teams hub — every team in the workspace, as cards by default.
 *
 * @remarks
 * A Client Component at `/orgs/[orgId]/teams`. Until now this roster had no destination: rows were
 * inert because there was no team page to open, and each one was nonetheless wired as a drag source
 * whose payload nothing in the app accepted. Both halves of that are fixed here — a card opens the
 * team, and the drag source now has somewhere to land.
 *
 * **Cards are the default and the list is the alternative**, which is the reverse of every other
 * roster in Docket. A team is one of the few objects here a person recognizes rather than reads:
 * the list is short, it changes slowly, and the question being asked of it is "which one is mine",
 * answered faster by a shape and a color than by a name in row four. The list stays one menu item
 * away for the job rows genuinely do better — comparing counts down a column.
 *
 * The layout lives in the Display menu rather than beside it, so the page keeps one control row no
 * matter how many capabilities it grows, and it rides the URL so a shared link arrives in the
 * layout the sender was looking at.
 *
 * Four slices compose here — teams, their display metadata, every team's roster, and the project /
 * task counts. Each is one request for the whole workspace rather than one per team, so a hub of
 * twenty teams costs five requests rather than sixty.
 */
export default function TeamsListClient(): JSX.Element {
  const {
    params: { orgId },
  } = useTypedRoute('/orgs/[orgId]/teams');
  const { openCreate } = useCreateObject();

  const projectNoun = useVocabulary('project').toLowerCase();
  const projectNounPlural = useVocabulary('project', { plural: true }).toLowerCase();
  const taskNoun = useVocabulary('task').toLowerCase();
  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();

  const { state, setFilters, setGroupBy, setSort } = useViewState();
  const { layout, setLayout } = useLayoutMode('cards');

  // The roster is the primary slice (its load gates the page); the rest enrich each card and
  // degrade to nothing if they fail, which is why none of them gates rendering.
  const teamsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.teams(orgId),
      () => api.v1.orgs[':orgId'].teams.$get({ param: { orgId } }),
      'Could not load your teams.',
    ),
  );
  const displaysQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.entityDisplays(orgId, 'team'),
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'].$get({
          param: { orgId, subjectType: 'team' },
        }),
      'Could not load team icons.',
    ),
  );
  const rostersQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.teamRosters(orgId),
      () => api.v1.orgs[':orgId'].teams.rosters.$get({ param: { orgId } }),
      'Could not load team members.',
    ),
  );
  const projectsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.projects(orgId),
      () => api.v1.orgs[':orgId'].projects.$get({ param: { orgId }, query: {} }),
      'Could not load projects.',
    ),
  );
  const tasksQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.tasks(orgId),
      () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId }, query: {} }),
      'Could not load tasks.',
    ),
  );

  const teams = useMemo(() => teamsQ.data?.items ?? [], [teamsQ.data]);
  const projects = useMemo(() => projectsQ.data?.items ?? [], [projectsQ.data]);
  const tasks = useMemo(() => tasksQ.data?.items ?? [], [tasksQ.data]);

  const loading = teamsQ.isPending;
  const loadError = teamsQ.isError ? userErrorMessage(teamsQ.error, 'Could not load teams.') : null;

  /** Per-team project counts (a project belongs via `project.teamId`). */
  const projectCountByTeam = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects) {
      if (project.teamId) counts.set(project.teamId, (counts.get(project.teamId) ?? 0) + 1);
    }
    return counts;
  }, [projects]);

  /** Per-team task counts (a task belongs via `task.teamId`). */
  const taskCountByTeam = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      counts.set(task.teamId, (counts.get(task.teamId) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);

  /**
   * Display metadata by team id.
   *
   * @remarks
   * Only customized teams come back from the API, so a miss is the normal case rather than an
   * error — {@link defaultEntityDisplay} composes the same defaults the server would have.
   */
  const displayByTeam = useMemo(() => {
    const byId = new Map<string, EntityDisplayOut>();
    for (const display of displaysQ.data?.items ?? []) byId.set(display.subjectId, display);
    return byId;
  }, [displaysQ.data]);

  /** Members by team id, for the card's face stack. */
  const membersByTeam = useMemo(() => {
    const byTeam = new Map<string, TeamCardMember[]>();
    for (const entry of rostersQ.data?.items ?? []) {
      const list = byTeam.get(entry.teamId) ?? [];
      list.push({
        actorId: entry.actorId,
        displayName: entry.displayName,
        avatar: entry.avatar,
      });
      byTeam.set(entry.teamId, list);
    }
    return byTeam;
  }, [rostersQ.data]);

  /** The team field catalog driving the toolbar + the apply engine. */
  const catalog = useMemo(() => buildTeamCatalog(), []);

  /** Filter + sort + group the loaded roster client-side per the active view state. */
  const applied = useMemo(() => applyView(teams, state, catalog), [teams, state, catalog]);

  /** Adapt a team to the dense-row view-model the list layout draws. */
  const toRow = useCallback(
    (team: TeamOut): TeamRow => ({
      team,
      display: displayByTeam.get(team.id) ?? defaultEntityDisplay('team', team.id),
      projectCount: projectCountByTeam.get(team.id) ?? 0,
      taskCount: taskCountByTeam.get(team.id) ?? 0,
      workflowStateCount: team.workflowStates?.length ?? 0,
    }),
    [displayByTeam, projectCountByTeam, taskCountByTeam],
  );

  /** Render one group's teams in whichever layout is active. */
  const renderTeams = useCallback(
    (rows: readonly TeamOut[], ariaLabel: string): JSX.Element => {
      if (layout === 'list') {
        return (
          <TeamRows
            rows={rows.map(toRow)}
            orgId={orgId}
            projectNoun={projectNoun}
            projectNounPlural={projectNounPlural}
            taskNoun={taskNoun}
            taskNounPlural={taskNounPlural}
            ariaLabel={ariaLabel}
          />
        );
      }
      return (
        <ul
          aria-label={ariaLabel}
          className="grid list-none grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3"
        >
          {rows.map((team) => (
            <li key={team.id} className="contents">
              <TeamCard
                team={team}
                display={displayByTeam.get(team.id) ?? defaultEntityDisplay('team', team.id)}
                members={membersByTeam.get(team.id) ?? []}
                projectCount={projectCountByTeam.get(team.id) ?? 0}
                taskCount={taskCountByTeam.get(team.id) ?? 0}
                href={`/orgs/${orgId}/teams/${team.id}`}
                projectNoun={projectNoun}
                projectNounPlural={projectNounPlural}
                taskNoun={taskNoun}
                taskNounPlural={taskNounPlural}
              />
            </li>
          ))}
        </ul>
      );
    },
    [
      displayByTeam,
      layout,
      membersByTeam,
      orgId,
      projectCountByTeam,
      projectNoun,
      projectNounPlural,
      taskCountByTeam,
      taskNoun,
      taskNounPlural,
      toRow,
    ],
  );

  const openTeamComposer = (): void => {
    openCreate({ kind: 'team', initialWorkspaceId: orgId });
  };

  return (
    <div className="flex w-full flex-col gap-4 px-3 py-4 @2xl:gap-5 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-on-surface text-title-large">Teams</h1>
          <p className="text-on-surface-variant text-xs">
            The units that own your work — each with its own workflow, cycles, and triage queue.
          </p>
        </div>
        <Button type="button" className="gap-1.5" onClick={openTeamComposer}>
          <Plus aria-hidden="true" className="size-4" />
          New team
        </Button>
      </header>

      {!loading && !loadError && teams.length > 0 ? (
        <FilterToolbar
          catalog={catalog}
          state={state}
          onFiltersChange={setFilters}
          onGroupByChange={setGroupBy}
          onSortChange={setSort}
          displayExtras={<LayoutMenuItems layout={layout} onLayoutChange={setLayout} />}
        />
      ) : null}

      {loading ? (
        layout === 'list' ? (
          <ListSkeleton />
        ) : (
          <TeamCardsSkeleton />
        )
      ) : loadError ? (
        <p role="alert" className="text-error text-body-medium p-4">
          {loadError}
        </p>
      ) : teams.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No teams yet"
          cta={{
            label: 'Create your first team',
            onClick: openTeamComposer,
          }}
        />
      ) : applied.rows.length === 0 ? (
        <EmptyState icon={Users} title="No matching teams" />
      ) : applied.groups ? (
        <div className="flex flex-col gap-4">
          {applied.groups.map((group) => (
            <section key={group.id} className="flex flex-col gap-2">
              <h2 className="text-on-surface-variant flex items-center gap-2 px-1 text-xs font-medium">
                <span>{group.label}</span>
                <span className="text-on-surface-variant/70 tabular-nums">{group.rows.length}</span>
              </h2>
              {renderTeams(group.rows, `Teams — ${group.label}`)}
            </section>
          ))}
        </div>
      ) : (
        renderTeams(applied.rows, 'Teams')
      )}
    </div>
  );
}

/** Props for {@link LayoutMenuItems}. */
interface LayoutMenuItemsProps {
  layout: LayoutMode;
  onLayoutChange: (layout: LayoutMode) => void;
}

/**
 * The layout chooser, contributed into the Display menu.
 *
 * @remarks
 * A menu item rather than a pair of pills beside the toolbar. Two peer buttons would compete with
 * Filter and Display for the same row and would put the page one capability away from wrapping onto
 * a second line, which persistent control rows are not allowed to do.
 */
function LayoutMenuItems({ layout, onLayoutChange }: LayoutMenuItemsProps): JSX.Element {
  return (
    <>
      <DropdownMenuLabel>Layout</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={layout}
        onValueChange={(value) => {
          onLayoutChange(value === 'list' ? 'list' : 'cards');
        }}
      >
        <DropdownMenuRadioItem value="cards">
          <LayoutGrid aria-hidden="true" className="size-4" />
          Cards
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="list">
          <ListView aria-hidden="true" className="size-4" />
          List
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
    </>
  );
}
