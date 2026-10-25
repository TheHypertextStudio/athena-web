'use client';

import { TabPanel, Tabs, type TabsItem } from '@docket/ui/primitives';
import type { UpdateOut } from '@docket/work/update-contract';
import { ActorAvatar, type PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { useQueryClient } from '@tanstack/react-query';

import { useTypedRoute } from '@/lib/app-location';
import { type JSX, useEffect, useMemo, useState } from 'react';

import { ConfirmDestructiveDialog } from '@docket/ui/components';
import { TemplateAwareEntityDocument } from '@/components/editor/apply-description-template';
import { EditableTitle } from '@/components/editor/editable-title';
import { EditableSubtitle } from '@/components/editor/editable-subtitle';
import { EntityIconPicker } from '@/components/entity-display/entity-icon-picker';
import { useEntityDisplay } from '@/components/entity-display/use-entity-display';
import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { LatestUpdateSummary } from '@/components/entity-detail/latest-update-summary';
import { PartialLoadBanner, QueryLoadFailure } from '@/components/feedback';
import { PageContainer } from '@/components/views/page-layout';
import { ProgramPrintSummary } from '@/components/programs/program-print-summary';
import { ContainerDetailLoading } from '@/components/views/entity-snapshot-metadata';
import { useDetailTab } from '@/components/views/use-detail-tab';
import { WorkTemplateHeader } from '@/components/templates/work-template-header';
import { EntityDetailLayout, EntityMetadataRow } from '@/components/views/entity-detail-layout';
import { ProgramProjectsPanel } from '@/components/programs/program-projects-panel';
import { FlowSnapshot } from '@/components/programs/flow-snapshot';
import { programFlowMetrics } from '@/components/programs/flow-metrics';
import { ProgramPropertiesPanel } from '@/components/programs/properties-panel';
import { ProgramWorkView } from '@/components/programs/program-work-view';
import { ProgramHeaderActions } from '@/components/programs/program-detail-header-actions';
import {
  ProgramSchedules,
  ProgramScheduleContext,
} from '@/components/work-schedules/program-schedules';
import { DetailUnavailable } from '@/components/entity-detail/detail-unavailable';
import { type ResolveActor, UpdatesPanel } from '@/components/entity-detail/updates-panel';
import { memberActorOptions } from '@/components/pickers/options';
import { useDocumentTitle } from '@/components/tabs/use-document-title';
import { useRegisterTabTitle } from '@/components/tabs/use-register-tab-title';
import { api } from '@/lib/api';
import { apiQueryOptions, useApiQuery } from '@/lib/query';
import {
  aggregateLoadState,
  programDetailAggregateDef,
  terminalDetailFailure,
} from '@/lib/detail-aggregate';
import { orgMembersDef } from '@/lib/use-org-membership';
import { useProgramDeleteMutation, useProgramMutations } from '@/lib/use-program-mutations';
import { useNavigationSnapshot } from '@/lib/use-navigation-snapshot';
import {
  removeNavigationSnapshot,
  seedNavigationSnapshot,
} from '@/lib/navigation-snapshot-runtime';
import { useAppRouter } from '@/lib/interactions/navigation';
import { openProjectRecord } from '@/lib/local-first-navigation';

type TabId = 'overview' | 'projects' | 'work' | 'schedules' | 'updates';
const PROGRAM_TABS = ['overview', 'projects', 'work', 'schedules', 'updates'] as const;

const PROGRAM_TAB_ITEMS: readonly TabsItem[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'projects', label: 'Projects' },
  { value: 'work', label: 'Work' },
  { value: 'schedules', label: 'Schedules' },
  { value: 'updates', label: 'Updates' },
];

const PROGRAM_HEADER_DENSITY = {
  overview: 'full',
  projects: 'full',
  work: 'full',
  schedules: 'compact',
  updates: 'full',
} as const;
const PROGRAM_HEADER_PRESENTATION = {
  full: { iconSize: 48, titleClass: 'text-headline-medium text-on-surface' },
  compact: { iconSize: 32, titleClass: 'text-title-large text-on-surface' },
} as const;
/** ProgramDetailPage renders the authenticated program page. */
export default function ProgramDetailPage(): JSX.Element {
  const router = useAppRouter();
  const queryClient = useQueryClient();
  const { params } = useTypedRoute('/orgs/[orgId]/programs/[programId]');
  const { orgId, programId } = params;
  const navigationSnapshot = useNavigationSnapshot('program', programId);

  const programLabel = useVocabulary('program');
  const programPlural = useVocabulary('program', { plural: true });
  const refreshTitle = `Could not refresh this ${programLabel.toLowerCase()}`;
  const cyclesLabel = useVocabulary('cycle', { plural: true });
  const projectNounCased = useVocabulary('project');

  const aggregateDef = programDetailAggregateDef(orgId, programId);
  const detailKey = aggregateDef.queryKey;
  const updatesKey = useMemo(() => [...detailKey, 'updates'] as const, [detailKey]);

  const { tab, setTab } = useDetailTab<TabId>(PROGRAM_TABS);
  const headerDensity = PROGRAM_HEADER_DENSITY[tab];
  const headerPresentation = PROGRAM_HEADER_PRESENTATION[headerDensity];
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);

  const [aggregateEnabled, setAggregateEnabled] = useState(true);
  const [terminalState, setTerminalState] = useState<'forbidden' | 'not-found' | null>(null);
  const aggregateQ = useApiQuery({ ...aggregateDef, enabled: aggregateEnabled });
  const terminalFailure = terminalDetailFailure(aggregateQ.error);
  const aggregate = aggregateQ.data ?? null;
  const program = aggregate?.defaultView.program ?? null;
  const aggregateState = aggregateLoadState(
    aggregateQ.data,
    aggregateQ.isPending,
    aggregateQ.isError,
  );
  const entityDisplay = useEntityDisplay({
    organizationId: orgId,
    subjectType: 'program',
    subjectId: programId,
    errorMessage: 'Could not load this program’s icon.',
  });

  useEffect(() => {
    setTerminalState(null);
  }, [programId]);

  useEffect(() => {
    if (aggregate) seedNavigationSnapshot(aggregate.snapshot);
  }, [aggregate]);

  useEffect(() => {
    if (terminalFailure === null) return;
    setTerminalState(terminalFailure);
    setAggregateEnabled(false);
    void removeNavigationSnapshot('program', programId);
    queryClient.removeQueries({ queryKey: detailKey, exact: true });
  }, [detailKey, programId, queryClient, terminalFailure]);

  // The tab bar and the browser tab both follow the name on screen, including through a rename.
  useRegisterTabTitle('program', orgId, programId, program?.name);
  useDocumentTitle(program?.name);
  const membersQ = useApiQuery({
    ...orgMembersDef(orgId),
    enabled: ownerPickerOpen,
  });
  const members = membersQ.data?.items ?? [];
  const currentActorId = aggregate?.viewer.actorId;

  const updatesQ = useApiQuery(
    apiQueryOptions(
      updatesKey,
      () => api.v1.orgs[':orgId'].programs[':id'].updates.$get({ param: { orgId, id: programId } }),
      'Could not load updates.',
      { enabled: tab === 'overview' || tab === 'updates' },
    ),
  );
  const updates = useMemo<readonly UpdateOut[]>(() => updatesQ.data?.items ?? [], [updatesQ.data]);
  const programWorkQ = useApiQuery(
    apiQueryOptions(
      [...detailKey, 'overview-work'] as const,
      () =>
        api.v1.orgs[':orgId'].programs[':id'].work.$get({
          param: { orgId, id: programId },
          query: {},
        }),
      'Could not load Program flow.',
      { enabled: aggregate !== null && tab === 'overview' },
    ),
  );
  const categoryOfTask = useCategoryOf('task');
  const flowMetrics = useMemo(
    () => programFlowMetrics(programWorkQ.data, categoryOfTask),
    [categoryOfTask, programWorkQ.data],
  );
  const healthAsOf = useMemo(
    () => updates.find((update) => update.health !== null)?.createdAt ?? null,
    [updates],
  );

  const resolveActor = useMemo<ResolveActor>(() => {
    const byId = new Map<string, { name: string; kind: 'human' | 'agent' | 'team' }>();
    for (const author of updatesQ.data?.authors ?? []) {
      byId.set(author.actorId, { name: author.displayName, kind: author.kind });
    }
    const owner = aggregate?.references.owner;
    if (owner) byId.set(owner.actorId, { name: owner.displayName, kind: 'human' });
    for (const member of members)
      byId.set(member.actorId, { name: member.displayName, kind: 'human' });
    return (actorId) =>
      actorId
        ? (byId.get(actorId) ?? { name: 'System', kind: 'human' })
        : { name: 'System', kind: 'human' };
  }, [aggregate?.references.owner, members, updatesQ.data?.authors]);

  const { patchProgram, postUpdate, updatePosting } = useProgramMutations(
    orgId,
    programId,
    programLabel,
    detailKey,
  );

  const canEdit = aggregate?.capabilities.manage ?? false;
  const canCustomizeIdentity = aggregate?.capabilities.contribute ?? false;

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const deleteProgram = useProgramDeleteMutation(orgId, programId, programLabel, () => {
    router.push(`/orgs/${orgId}/programs`);
  });

  const memberOptions = useMemo<readonly PickerOption[]>(() => {
    const options = memberActorOptions(members);
    const owner = aggregate?.references.owner;
    if (!owner || options.some((option) => option.value === owner.actorId)) return options;
    return [
      {
        value: owner.actorId,
        label: owner.displayName,
        icon: (
          <ActorAvatar kind="human" name={owner.displayName} avatarUrl={owner.avatar} size={20} />
        ),
      },
      ...options,
    ];
  }, [aggregate?.references.owner, members]);

  if (terminalState !== null) {
    return (
      <DetailUnavailable
        noun={programLabel.toLowerCase()}
        forbidden={terminalState === 'forbidden'}
        backHref={`/orgs/${orgId}/programs`}
        backLabel={`Back to ${programPlural.toLowerCase()}`}
      />
    );
  }
  if (aggregateState === 'loading') {
    // placeholder: the program's own record — name, summary, the metric strip, detail tabs,
    // and the projects under it. The route carries only a program
    // id; even the tab row's counts come from the same read.
    //
    // Reached only on a cold open; arriving from a list or from the composer that just
    // created it, the record is cached and the real masthead renders straight away.
    return (
      <>
        <ContainerDetailLoading
          target="program"
          id={programId}
          entityName={programLabel}
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
  }

  if (aggregateState === 'error') {
    return (
      <PageContainer>
        <QueryLoadFailure title={`This ${programLabel.toLowerCase()}`} query={aggregateQ} />
      </PageContainer>
    );
  }

  if (!program) {
    return (
      <PageContainer>
        <p className="bg-surface-container-low text-on-surface-variant text-body-medium rounded-xl p-8 text-center">
          This {programLabel.toLowerCase()} could not be found.
        </p>
      </PageContainer>
    );
  }

  const health = program.health ?? null;

  return (
    <EntityDetailLayout
      headerDensity={headerDensity}
      object={{
        kind: 'program',
        id: programId,
        organizationId: orgId,
        title: program.name,
      }}
      printSummary={
        <ProgramPrintSummary
          program={program}
          ownerName={aggregate?.references.owner?.displayName ?? '—'}
        />
      }
      icon={
        <EntityIconPicker
          display={entityDisplay.display}

          workspaceId={orgId}
          entityName={program.name}
          editable={canCustomizeIdentity}
          pending={entityDisplay.mutation.isPending}
          loading={entityDisplay.loading}
          size={headerPresentation.iconSize}
          onChange={(glyph, colorKey, customColor) => {
            entityDisplay.mutation.mutate({ glyph, colorKey, customColor });
          }}
        />
      }
      title={
        <EditableTitle
          value={program.name}
          onSave={(name) => {
            patchProgram({ name });
          }}
          canEdit={canEdit}
          ariaLabel={`${programLabel} name`}
          className={headerPresentation.titleClass}
        />
      }
      subtitle={
        tab === 'schedules' ? undefined : (
          <EditableSubtitle
            value={program.summary}
            placeholder="Add a concise summary…"
            canEdit={canEdit}
            ariaLabel={`${programLabel} summary`}
            onSave={(summary) => {
              // Optional-not-nullable on the wire: an empty draft clears by sending '' (never null).
              patchProgram({ summary: summary ?? '' });
            }}
            className="text-on-surface-variant text-body-large"
          />
        )
      }
      metadata={
        tab === 'schedules' ? (
          <ProgramScheduleContext
            label={programLabel}
            onDetails={() => {
              setTab('overview');
            }}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <WorkTemplateHeader orgId={orgId} kind="program" work={program} canEdit={canEdit} />
            <EntityMetadataRow ariaLabel={`${programLabel} properties`}>
              <ProgramPropertiesPanel
                ownerId={program.ownerId ?? null}
                memberOptions={memberOptions}
                ownerLoading={membersQ.isPending}
                onOwnerPickerOpenChange={setOwnerPickerOpen}
                status={program.status}
                health={health}
                visibility={program.visibility}
                canEdit={canEdit}
                onOwnerChange={(ownerId) => {
                  patchProgram({ ownerId });
                }}
                onStatusChange={(status) => {
                  patchProgram({ status });
                }}
                onHealthChange={(next) => {
                  patchProgram({ health: next });
                }}
                onVisibilityChange={(visibility) => {
                  patchProgram({ visibility });
                }}
              />
            </EntityMetadataRow>
          </div>
        )
      }
      actions={
        <ProgramHeaderActions
          orgId={orgId}
          programId={programId}
          programName={program.name}
          programLabel={programLabel}
          canEdit={canEdit}
          compact={tab === 'schedules'}
          onDelete={() => {
            setConfirmDeleteOpen(true);
          }}
        />
      }
      tabs={
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as TabId);
          }}
          label={`${programLabel} sections`}
          items={PROGRAM_TAB_ITEMS}
        />
      }
    >
      {aggregateQ.isError ? (
        <PartialLoadBanner title={refreshTitle} onRetry={() => void aggregateQ.refetch()} />
      ) : null}
      <TabPanel
        hidden={!(tab === 'overview')}
        value="overview"
        className="flex min-w-0 flex-col gap-8"
        render={() => (
          <>
            {programWorkQ.isError ? (
              <PartialLoadBanner
                title={`${programLabel} flow could not load`}
                onRetry={() => void programWorkQ.refetch()}
              >
                The rest of this {programLabel.toLowerCase()} still works.
              </PartialLoadBanner>
            ) : null}
            <FlowSnapshot
              health={health}
              healthAsOf={healthAsOf}
              metrics={{ ...flowMetrics, projects: program.rollup.projects }}
              projectsLabel={projectNounCased}
              cyclesLabel={cyclesLabel}
            />
            <LatestUpdateSummary
              updates={updates}
              loading={updatesQ.isPending}
              resolveActor={resolveActor}
            />
            <TemplateAwareEntityDocument
              orgId={orgId}
              kind="program"
              currentActorId={currentActorId ?? null}
              value={program.description}
              canEdit={canEdit}
              onSave={(description) => {
                patchProgram({ description });
              }}
              placeholder={`Describe this ${programLabel.toLowerCase()}…`}
            />
          </>
        )}
      />

      <TabPanel
        hidden={!(tab === 'projects')}
        value="projects"
        render={() => (
          <>
            <ProgramProjectsPanel
              orgId={orgId}
              programId={programId}
              projectNoun={projectNounCased}
              canEdit={canEdit}
              onOpenProject={(project) => {
                openProjectRecord(project);
              }}
            />
          </>
        )}
      />

      <TabPanel
        hidden={!(tab === 'work')}
        value="work"
        render={() => (
          <>
            <ProgramWorkView orgId={orgId} programId={programId} />
          </>
        )}
      />

      <TabPanel
        hidden={!(tab === 'updates')}
        value="updates"
        render={() => (
          <>
            <UpdatesPanel
              orgId={orgId}
              submissionScope={`update:${orgId}:program:${programId}`}
              updates={updates}
              loading={updatesQ.isPending}
              loadFailure={updatesQ.isError ? updatesQ : null}
              resolveActor={resolveActor}
              posting={updatePosting}
              onPost={postUpdate}
            />
          </>
        )}
      />

      <ProgramSchedulePanel
        orgId={orgId}
        programId={programId}
        programName={program.name}
        canEdit={canEdit}
        active={tab === 'schedules'}
      />

      <ConfirmDestructiveDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={`Delete this ${programLabel.toLowerCase()}?`}
        description={`This permanently removes "${program.name}" and unlinks its projects and work. This can't be undone.`}
        confirmLabel={`Delete ${programLabel.toLowerCase()}`}
        pending={deleteProgram.pending}
        onConfirm={() => {
          deleteProgram.deleteProgram(() => {
            setConfirmDeleteOpen(false);
          });
        }}
      />
    </EntityDetailLayout>
  );
}

function ProgramSchedulePanel({
  orgId,
  programId,
  programName,
  canEdit,
  active,
}: {
  readonly orgId: string;
  readonly programId: string;
  readonly programName: string;
  readonly canEdit: boolean;
  readonly active: boolean;
}): JSX.Element {
  return (
    <TabPanel value="schedules" hidden={!active}>
      <ProgramSchedules
        orgId={orgId}
        programId={programId}
        programName={programName}
        canEdit={canEdit}
        enabled={active}
      />
    </TabPanel>
  );
}
