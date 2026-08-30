'use client';

import type { UpdateOut } from '@docket/types';
import { ActorAvatar, type PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Ellipsis, Trash2 } from '@docket/ui/icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  ControlGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
  menuDestructiveItem,
  type TabsItem,
} from '@docket/ui/primitives';
import { useTypedRoute } from '@/lib/app-location';
import { type JSX, useEffect, useMemo, useState } from 'react';

import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { TemplateAwareEntityDocument } from '@/components/editor/apply-description-template';
import { EditableTitle } from '@/components/editor/editable-title';
import { EditableSubtitle } from '@/components/editor/editable-subtitle';
import { EntityIconPicker } from '@/components/entity-display/entity-icon-picker';
import { useEntityDisplay } from '@/components/entity-display/use-entity-display';
import { useCategoryOf } from '@/components/entity-display/use-work-status';
import { LatestUpdateSummary } from '@/components/entity-detail/latest-update-summary';
import { PageContainer } from '@/components/views/page-layout';
import { DetailPrintSummary } from '@/components/views/detail-print-summary';
import { EntityDetailSkeleton } from '@/components/views/entity-detail-skeleton';
import { useDetailTab } from '@/components/views/use-detail-tab';
import { EntityDetailLayout, EntityMetadataRow } from '@/components/views/entity-detail-layout';
import { ProgramProjectsPanel } from '@/components/programs/program-projects-panel';
import { FlowSnapshot } from '@/components/programs/flow-snapshot';
import { programFlowMetrics } from '@/components/programs/flow-metrics';
import { ProgramPropertiesPanel } from '@/components/programs/properties-panel';
import { ProgramWorkView } from '@/components/programs/program-work-view';
import { type ResolveActor, UpdatesPanel } from '@/components/entity-detail/updates-panel';
import { memberActorOptions } from '@/components/pickers/options';
import { PublishAction } from '@/components/publishing/publish-action';
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
import { userErrorMessage } from '@/lib/problem';
import { useNavigationSnapshot } from '@/lib/use-navigation-snapshot';
import {
  removeNavigationSnapshot,
  seedNavigationSnapshot,
} from '@/lib/navigation-snapshot-runtime';
import { useAppRouter } from '@/lib/interactions/navigation';
import { openProjectRecord } from '@/lib/local-first-navigation';

type TabId = 'overview' | 'projects' | 'work' | 'updates';
const PROGRAM_TABS = ['overview', 'projects', 'work', 'updates'] as const;

/** ProgramDetailPage renders the authenticated program page. */
export default function ProgramDetailPage(): JSX.Element {
  const router = useAppRouter();
  const queryClient = useQueryClient();
  const { params } = useTypedRoute('/orgs/[orgId]/programs/[programId]');
  const { orgId, programId } = params;
  const navigationSnapshot = useNavigationSnapshot('program', programId);

  const programLabel = useVocabulary('program');
  const cyclesLabel = useVocabulary('cycle', { plural: true });
  const projectNounCased = useVocabulary('project');

  const aggregateDef = programDetailAggregateDef(orgId, programId);
  const detailKey = aggregateDef.queryKey;
  const updatesKey = useMemo(() => [...detailKey, 'updates'] as const, [detailKey]);

  const { tab, setTab } = useDetailTab<TabId>(PROGRAM_TABS);
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

  const { patchProgram, postUpdate, propsError, updatePosting, updateError } = useProgramMutations(
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

  const tabs: readonly TabsItem[] = [
    { value: 'overview', label: 'Overview', priority: 0 },
    { value: 'projects', label: 'Projects', priority: 1 },
    { value: 'work', label: 'Work', priority: 2 },
    { value: 'updates', label: 'Updates', priority: 3 },
  ];

  if (terminalState !== null) {
    return (
      <p role="alert" className="text-on-surface-variant mx-auto max-w-7xl p-6">
        {terminalState === 'forbidden'
          ? `You no longer have access to this ${programLabel.toLowerCase()}.`
          : `This ${programLabel.toLowerCase()} no longer exists.`}
      </p>
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
        <EntityDetailSkeleton
          tabCount={4}
          entityName={programLabel}
          title={navigationSnapshot?.name}
          snapshotMetadata={
            navigationSnapshot ? (
              <span className="text-on-surface-variant text-body-small">
                {navigationSnapshot.status}
                {navigationSnapshot.health ? ` · ${navigationSnapshot.health}` : ''}
              </span>
            ) : undefined
          }
        />
        {aggregateQ.isError ? (
          <p role="alert" className="text-error text-body-medium px-6 pb-6">
            Could not refresh this {programLabel.toLowerCase()}.
          </p>
        ) : null}
      </>
    );
  }

  if (aggregateState === 'error') {
    return (
      <PageContainer>
        <p role="alert" className="text-error text-sm">
          {userErrorMessage(aggregateQ.error, 'Could not load this program.')}
        </p>
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
      object={{
        kind: 'program',
        id: programId,
        organizationId: orgId,
        title: program.name,
      }}
      printSummary={
        <DetailPrintSummary
          title={program.name}
          summary={program.summary}
          description={program.description}
          properties={[
            { label: 'Status', value: program.status.replace('_', ' ') },
            { label: 'Health', value: health ? health.replace('_', ' ') : '—' },
            { label: 'Owner', value: aggregate?.references.owner?.displayName ?? '—' },
            { label: 'Visibility', value: program.visibility },
          ]}
        />
      }
      icon={
        <EntityIconPicker
          display={entityDisplay.display}
          entityName={program.name}
          editable={canCustomizeIdentity}
          pending={entityDisplay.mutation.isPending}
          loading={entityDisplay.loading}
          size={48}
          onChange={(iconKey, colorKey, customColor) => {
            entityDisplay.mutation.mutate({ iconKey, colorKey, customColor });
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
          className="text-headline-medium text-on-surface font-medium"
        />
      }
      subtitle={
        <EditableSubtitle
          value={program.summary}
          placeholder="Add a concise summary…"
          canEdit={canEdit}
          ariaLabel={`${programLabel} summary`}
          onSave={(summary) => {
            // Optional-not-nullable on the wire: an empty draft clears by sending '' (never null).
            patchProgram({ summary: summary ?? '' });
          }}
          className="text-on-surface-variant text-body-large font-normal"
        />
      }
      metadata={
        <div className="flex flex-col gap-2">
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
          {propsError ? (
            <p role="alert" className="text-error text-body-medium px-1">
              {propsError}
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
            subjectKind="program"
            subjectId={programId}
            title={program.name}
            noun={programLabel}
            canPublish={canEdit}
          />
          {canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" iconOnly aria-label={`${programLabel} actions`}>
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" width="sm">
                <DropdownMenuItem
                  className={menuDestructiveItem()}
                  onSelect={() => {
                    setConfirmDeleteOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete {programLabel.toLowerCase()}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </ControlGroup>
      }
      tabs={
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as TabId);
          }}
          label={`${programLabel} sections`}
          overflow={{ menuLabel: `More ${programLabel} sections` }}
          items={tabs}
        />
      }
    >
      {aggregateQ.isError ? (
        <p role="alert" className="text-error text-body-medium">
          Could not refresh this {programLabel.toLowerCase()}.
        </p>
      ) : null}
      {tab === 'overview' ? (
        <div
          role="tabpanel"
          id="tabpanel-overview"
          aria-labelledby="tab-overview"
          className="flex min-w-0 flex-col gap-8"
        >
          {programWorkQ.isError ? (
            <p role="alert" className="text-error text-body-medium">
              Could not load Program flow.
            </p>
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
        </div>
      ) : null}

      {tab === 'projects' ? (
        <div role="tabpanel" id="tabpanel-projects" aria-labelledby="tab-projects">
          <ProgramProjectsPanel
            orgId={orgId}
            programId={programId}
            projectNoun={projectNounCased}
            canEdit={canEdit}
            onOpenProject={(project) => {
              openProjectRecord(project);
            }}
          />
        </div>
      ) : null}

      {tab === 'work' ? (
        <div role="tabpanel" id="tabpanel-work" aria-labelledby="tab-work">
          <ProgramWorkView orgId={orgId} programId={programId} />
        </div>
      ) : null}

      {tab === 'updates' ? (
        <div role="tabpanel" id="tabpanel-updates" aria-labelledby="tab-updates">
          <UpdatesPanel
            updates={updates}
            loading={updatesQ.isPending}
            error={
              updatesQ.isError
                ? userErrorMessage(updatesQ.error, 'Could not load this program.')
                : null
            }
            resolveActor={resolveActor}
            posting={updatePosting}
            postError={updateError}
            onPost={(body, postHealth) => {
              return postUpdate(body, postHealth);
            }}
          />
        </div>
      ) : null}

      <ConfirmDestructiveDialog
        open={confirmDeleteOpen}
        onOpenChange={(next) => {
          // Clear any prior failure so a stale message never shows on reopen.
          deleteProgram.reset();
          setConfirmDeleteOpen(next);
        }}
        title={`Delete this ${programLabel.toLowerCase()}?`}
        description={`This permanently removes "${program.name}" and unlinks its projects and work. This can't be undone.`}
        error={deleteProgram.error}
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
