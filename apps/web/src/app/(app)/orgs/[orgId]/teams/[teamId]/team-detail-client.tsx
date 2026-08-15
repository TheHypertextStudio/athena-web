'use client';

/**
 * The team page: everything one team is doing, in four sections.
 *
 * @remarks
 * Teams were the only first-class object in Docket with no destination screen. Linear does not have
 * this page either — its docs describe a team as issues, cycles, triage, labels, templates and
 * settings, which is a container and a settings bundle rather than a place. That gap is the reason
 * this exists.
 *
 * Two audiences read it, and they want the same facts. A person opening a team wants to see what it
 * is for and what it is carrying. Athena wants the same, so it can route work without guessing —
 * from the description and the capacity report, which are the team's actual state.
 *
 * `agentGuidance` is deliberately **not** surfaced here, and should not be surfaced anywhere. Asking
 * someone to hand-write house rules per team is premature optimization of a problem Athena does not
 * have: it can read the description, the roster and the capacity report, which are things people
 * maintain anyway because the team needs them. A configuration knob that only earns its keep once
 * somebody fills it in is a knob that stays empty.
 *
 * Sections with nothing in them collapse rather than rendering empty frames. That is about genuinely
 * empty sections, not about kinds of team: a committee that meets monthly has cycles and tasks like
 * anyone else, and nothing here treats it as a lesser sort of team.
 */
import type { EntityDisplayColorKey, EntityDisplayIconKey, EntityDisplayOut } from '@docket/types';
import { defaultEntityDisplay } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { ChevronLeft, Folder } from '@docket/ui/icons';
import { Button, Skeleton, Tabs } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type JSX, useMemo, useState } from 'react';

import { EntityDocument } from '@/components/editor/entity-document';
import MentionedResources from '@/components/entity-detail/mentioned-resources';
import { EntityIconPicker } from '@/components/entity-display/entity-icon-picker';
import { CapacityChart } from '@/components/team-detail/capacity-chart';
import { ThroughputChart } from '@/components/team-detail/throughput-chart';
import { TeamPeople, TeamPeopleSkeleton } from '@/components/team-detail/team-people';
import { TeamCover } from '@/components/teams/team-cover';
import { EntityDetailLayout } from '@/components/views/entity-detail-layout';
import { api } from '@/lib/api';
import { useAppParams } from '@/lib/app-location';
import {
  apiQueryOptions,
  queryKeys,
  unwrap,
  useApiListQuery,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';
import { useEntityMentions } from '@/lib/use-entity-mentions';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useOrgMembership } from '@/lib/use-org-membership';

/** The team page's sections. */
type TabId = 'overview' | 'activity' | 'library' | 'people';

/** Which activity lens is showing. */
type ActivityLens = 'capacity' | 'throughput';

/**
 * The team detail page.
 *
 * @returns the rendered page.
 */
export default function TeamDetailClient(): JSX.Element {
  const { orgId, teamId } = useAppParams<{ orgId: string; teamId: string }>();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>('overview');
  const [lens, setLens] = useState<ActivityLens>('capacity');
  const [weightByEstimate, setWeightByEstimate] = useState(false);

  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();

  // The entity-display PUT route is gated at `contribute`, a lower bar than the `manage`
  // capability team CRUD itself requires — mirrors how program-detail-client.tsx resolves its
  // own `canEdit` from the org-wide roster rather than a team-scoped one.
  const membership = useOrgMembership(orgId);
  const canEdit = useOrgCapability(membership.members, membership.roles, 'contribute');

  const teamQ = useApiQuery(
    apiQueryOptions(
      queryKeys.team(orgId, teamId),
      () => api.v1.orgs[':orgId'].teams[':teamId'].$get({ param: { orgId, teamId } }),
      'Could not load this team.',
    ),
  );
  const displayQ = useApiQuery(
    apiQueryOptions(
      queryKeys.entityDisplay(orgId, 'team', teamId),
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$get({
          param: { orgId, subjectType: 'team', subjectId: teamId },
        }),
      'Could not load this team’s icon.',
    ),
  );
  const membersQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.teamMembers(orgId, teamId),
      () => api.v1.orgs[':orgId'].teams[':teamId'].members.$get({ param: { orgId, teamId } }),
      'Could not load this team’s people.',
    ),
  );
  const activityQ = useApiQuery(
    apiQueryOptions(
      queryKeys.teamActivity(orgId, teamId),
      () => api.v1.orgs[':orgId'].teams[':teamId'].activity.$get({ param: { orgId, teamId } }),
      'Could not load this team’s activity.',
    ),
  );

  const team = teamQ.data;
  const members = useMemo(() => membersQ.data?.items ?? [], [membersQ.data]);
  const display: EntityDisplayOut = displayQ.data ?? defaultEntityDisplay('team', teamId);

  const displayKey = queryKeys.entityDisplay(orgId, 'team', teamId);
  const displayMutation = useApiMutation<
    EntityDisplayOut,
    { iconKey: EntityDisplayIconKey; colorKey: EntityDisplayColorKey; customColor: string | null },
    { previous?: EntityDisplayOut | undefined }
  >({
    mutationFn: (json) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].display[':subjectType'][':subjectId'].$put({
            param: { orgId, subjectType: 'team', subjectId: teamId },
            json,
          }),
        'Could not customize this team.',
      ),
    onMutate: async ({ iconKey, colorKey, customColor }) => {
      await queryClient.cancelQueries({ queryKey: displayKey });
      const previous = queryClient.getQueryData<EntityDisplayOut>(displayKey);
      queryClient.setQueryData<EntityDisplayOut>(displayKey, {
        subjectType: 'team',
        subjectId: teamId,
        iconKey,
        colorKey,
        customColor,
        coverImage: previous?.coverImage ?? null,
        customized: true,
      });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(displayKey, context.previous);
    },
    invalidateKeys: [displayKey],
  });

  const saveDescription = useApiMutation({
    mutationFn: (value: string | null) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].teams[':teamId'].$patch({
            param: { orgId, teamId },
            json: { description: value },
          }),
        'Could not save the description.',
      ),
    // The Library is derived from this prose, so it has to be re-read after every save or the tab
    // would keep showing what the description used to reference.
    invalidateKeys: [
      queryKeys.team(orgId, teamId),
      queryKeys.entityMentions(orgId, 'team', teamId),
    ],
  });

  const mentions = useEntityMentions(orgId, 'team', teamId);
  const hasProse = Boolean(team?.description);

  if (teamQ.isPending) return <TeamDetailSkeleton />;

  if (teamQ.isError || !team) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 @2xl:p-6 @4xl:p-8">
        <BackToTeams orgId={orgId} />
        <p
          role="alert"
          className="border-outline-variant text-error text-body-medium rounded-xl border p-4"
        >
          {userErrorMessage(teamQ.error, 'Could not load this team.')}
        </p>
      </div>
    );
  }

  const referenceCount = mentions.external.length + mentions.entities.length;

  return (
    <EntityDetailLayout
      object={{
        kind: 'team',
        id: teamId,
        organizationId: orgId,
        title: team.name,
      }}
      // The layout owns the banner's height so it can collapse it on scroll; the cover just fills it.
      cover={<TeamCover display={display} teamName={team.name} className="size-full" />}
      eyebrow={<BackToTeams orgId={orgId} />}
      icon={
        <EntityIconPicker
          display={display}
          entityName={team.name}
          editable={canEdit}
          pending={displayMutation.isPending}
          size={48}
          onChange={(iconKey, colorKey, customColor) => {
            displayMutation.mutate({ iconKey, colorKey, customColor });
          }}
        />
      }
      title={
        <span className="flex flex-wrap items-center gap-2">
          {team.name}
          <span className="text-on-surface-variant bg-surface-container-high text-label-small rounded px-1.5 py-0.5 font-mono">
            {team.key}
          </span>
        </span>
      }
      {...(team.summary ? { subtitle: team.summary } : {})}
      tabs={
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as TabId);
          }}
          label="Team sections"
          items={[
            { value: 'overview', label: 'Overview' },
            { value: 'activity', label: 'Activity' },
            { value: 'library', label: 'Library' },
            { value: 'people', label: 'People' },
          ]}
        />
      }
    >
      {tab === 'overview' ? (
        // The same `min-block-size` formula `.detail-body` itself uses (globals.css) — `100%`
        // doesn't work here: it needs a *definite* parent height to resolve against, and
        // `.detail-body`'s own height comes from a `min-block-size`, not a definite value, so a
        // percentage on this section silently computes to nothing. `cqb` reads the actual
        // scroll-container size directly, sidestepping that. Overview is the whole tab today, with
        // no milestones or roster panel stacked below it the way a project's Overview has — so the
        // document below is free to grow into all the height this section reserves, rather than
        // reading as a business-card-sized box floating over an otherwise-empty panel.
        // EntityDocument's own flex chain is inert until a wrapper like this one actually has
        // spare height to give it.
        <section className="flex min-h-[calc(100cqb-4rem+var(--detail-collapse-range))] flex-col gap-6">
          <EntityDocument
            value={team.description}
            canEdit
            // A team charter is a few short sections. A contents rail beside two headings is
            // navigation for a distance nobody has to travel.
            contents={false}
            onSave={(value) => {
              saveDescription.mutate(value);
            }}
            placeholder="What is this team for? Anything you reference here shows up in its Library."
          />
        </section>
      ) : null}

      {tab === 'activity' ? (
        <section className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="bg-surface-container-low flex items-center gap-1 rounded-lg p-1">
              <LensButton
                active={lens === 'capacity'}
                onClick={() => {
                  setLens('capacity');
                }}
              >
                Capacity
              </LensButton>
              <LensButton
                active={lens === 'throughput'}
                onClick={() => {
                  setLens('throughput');
                }}
              >
                Throughput
              </LensButton>
            </div>
            {lens === 'capacity' ? (
              <LensButton
                active={weightByEstimate}
                onClick={() => {
                  setWeightByEstimate(!weightByEstimate);
                }}
              >
                By points
              </LensButton>
            ) : null}
          </div>

          {activityQ.isPending ? (
            // placeholder: the team's open work by state, and its 30-day open/completed trend.
            <Skeleton aria-hidden="true" className="h-40 w-full rounded-xl" />
          ) : activityQ.isError ? (
            <p role="alert" className="text-error text-body-medium">
              {userErrorMessage(activityQ.error, 'Could not load this team’s activity.')}
            </p>
          ) : lens === 'capacity' ? (
            <CapacityChart capacity={activityQ.data.capacity} weightByEstimate={weightByEstimate} />
          ) : (
            <ThroughputChart
              throughput={activityQ.data.throughput}
              windowDays={activityQ.data.windowDays}
            />
          )}
        </section>
      ) : null}

      {tab === 'library' ? (
        <section className="flex flex-col gap-6">
          <MentionedResources
            heading="Resources"
            mentions={mentions.external}
            pending={mentions.isPending}
            hasProse={hasProse}
          />
          <MentionedResources
            heading="Work referenced here"
            mentions={mentions.entities}
            pending={mentions.isPending}
            hasProse={hasProse}
          />
          {referenceCount === 0 && !mentions.isPending ? (
            <EmptyState
              icon={Folder}
              title="Nothing in the library yet"
              body="Mention a document or a project in the team description and it appears here — nobody has to attach it separately."
              cta={{
                label: 'Write the description',
                onClick: () => {
                  setTab('overview');
                },
              }}
            />
          ) : null}
        </section>
      ) : null}

      {tab === 'people' ? (
        <section className="flex flex-col gap-4">
          {membersQ.isPending ? (
            <TeamPeopleSkeleton />
          ) : (
            <TeamPeople members={members} taskNounPlural={taskNounPlural} />
          )}
        </section>
      ) : null}

      {displayMutation.error ? (
        <p role="alert" className="text-error text-body-medium">
          {userErrorMessage(displayMutation.error, 'Could not customize this team.')}
        </p>
      ) : null}
    </EntityDetailLayout>
  );
}

/** The breadcrumb back to the hub. */
function BackToTeams({ orgId }: { orgId: string }): JSX.Element {
  return (
    <Link
      href={`/orgs/${orgId}/teams`}
      className="text-on-surface-variant hover:text-on-surface focus-visible:ring-ring text-label-small inline-flex w-fit items-center gap-1 rounded outline-none focus-visible:ring-2"
    >
      <ChevronLeft aria-hidden="true" className="size-3.5" />
      Teams
    </Link>
  );
}

/** One segmented-control button in the activity lens switcher. */
function LensButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      size="sm"
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** The page's loading state. */
function TeamDetailSkeleton(): JSX.Element {
  // placeholder: the team's identity, its tagline, and the counts behind each section tab.
  return (
    <div
      aria-hidden="true"
      className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 @2xl:p-6 @4xl:p-8"
    >
      <Skeleton className="h-4 w-16 rounded" />
      <Skeleton className="size-10 rounded-full" />
      <Skeleton className="h-8 w-64 rounded" />
      <Skeleton className="h-4 w-96 rounded" />
      <Skeleton className="h-9 w-full rounded" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}
