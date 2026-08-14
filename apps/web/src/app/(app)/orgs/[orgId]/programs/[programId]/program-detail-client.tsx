'use client';

import type { UpdateOut } from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Ellipsis, Trash2 } from '@docket/ui/icons';
import {
  Button,
  ControlGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
  type TabsItem,
} from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import { useAppParams } from '@/lib/app-location';
import { type JSX, useMemo, useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog';
import { EditableTitle } from '@/components/editor/editable-title';
import { EditableSubtitle } from '@/components/editor/editable-subtitle';
import { EntityDocument } from '@/components/editor/entity-document';
import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import { PageContainer } from '@/components/views/page-layout';
import { EntityDetailSkeleton } from '@/components/views/entity-detail-skeleton';
import { EntityDetailLayout, EntityMetadataRow } from '@/components/views/entity-detail-layout';
import { ProgramProjectsPanel } from '@/components/programs/program-projects-panel';
import { ProgramPropertiesPanel } from '@/components/programs/properties-panel';
import { ProgramWorkView } from '@/components/programs/program-work-view';
import { type ResolveActor, UpdatesPanel } from '@/components/entity-detail/updates-panel';
import { memberActorOptions } from '@/components/pickers/options';
import { PublishAction } from '@/components/publishing/publish-action';
import { useDocumentTitle } from '@/components/tabs/use-document-title';
import { useRegisterTabTitle } from '@/components/tabs/use-register-tab-title';
import { api } from '@/lib/api';
import { programRecordDef } from '@/lib/entity-records';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useOrgMembership } from '@/lib/use-org-membership';
import { fetchProgramDetail } from '@/lib/fetch-program-detail';
import { useProgramMutations } from '@/lib/use-program-mutations';
import { userErrorMessage } from '@/lib/problem';

type TabId = 'overview' | 'projects' | 'work' | 'updates';

/** ProgramDetailPage renders the authenticated program page. */
export default function ProgramDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useAppParams<{ orgId: string; programId: string }>();
  const { orgId, programId } = params;

  const programLabel = useVocabulary('program');
  const projectNounCased = useVocabulary('project');

  const detailKey = queryKeys.program(orgId, programId);
  const updatesKey = useMemo(() => [...detailKey, 'updates'] as const, [detailKey]);

  const [tab, setTab] = useState<TabId>('overview');

  const detailQ = useApiQuery(
    apiQueryOptions(
      detailKey,
      fetchProgramDetail(orgId, programId),
      `Could not load this ${programLabel.toLowerCase()}.`,
    ),
  );
  // The program's own row, read apart from the composite above it, so the masthead can paint from
  // whatever arrived first — the composer that just created it, a warmed list, or one cheap read.
  const recordQ = useApiQuery(programRecordDef(orgId, programId));
  const detail = detailQ.data ?? null;
  const program = detail?.program ?? recordQ.data ?? null;

  // The tab bar and the browser tab both follow the name on screen, including through a rename.
  useRegisterTabTitle('program', orgId, programId, program?.name);
  useDocumentTitle(program?.name);
  // Capabilities come from the org-wide roster keys rather than the composite, so they resolve on
  // their own fast path. `useOrgCapability` fails closed, which is right for a guest and wrong for
  // a page that is merely still loading — and on screen the two are the same inert page.
  const membership = useOrgMembership(orgId);
  const members = detail?.members ?? membership.members;
  const agents = detail?.agents ?? [];
  const roles = detail?.roles ?? membership.roles;

  const updatesQ = useApiQuery(
    apiQueryOptions(
      updatesKey,
      () => api.v1.orgs[':orgId'].programs[':id'].updates.$get({ param: { orgId, id: programId } }),
      'Could not load updates.',
    ),
  );
  const updates = useMemo<readonly UpdateOut[]>(() => updatesQ.data?.items ?? [], [updatesQ.data]);

  const resolveActor = useMemo<ResolveActor>(() => {
    const byId = new Map<string, { name: string; kind: 'human' | 'agent' | 'team' }>();
    for (const member of members)
      byId.set(member.actorId, { name: member.displayName, kind: 'human' });
    for (const agent of agents) {
      const existing = byId.get(agent.actorId);
      byId.set(
        agent.actorId,
        existing ? { ...existing, kind: 'agent' } : { name: 'Agent', kind: 'agent' },
      );
    }
    return (actorId) =>
      actorId
        ? (byId.get(actorId) ?? { name: 'System', kind: 'human' })
        : { name: 'System', kind: 'human' };
  }, [members, agents]);

  const { patchProgram, postUpdate, propsError, updatePosting, updateError } = useProgramMutations(
    orgId,
    programId,
    programLabel,
    detailKey,
    updatesKey,
  );

  const canEdit = useOrgCapability(members, roles, 'manage');

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const deleteProgram = useApiMutation({
    mutationFn: () =>
      unwrap(
        () => api.v1.orgs[':orgId'].programs[':id'].$delete({ param: { orgId, id: programId } }),
        `Could not delete this ${programLabel.toLowerCase()}.`,
      ),
    invalidateKeys: [queryKeys.programs(orgId)],
    onSuccess: () => {
      router.push(`/orgs/${orgId}/programs`);
    },
  });

  const memberOptions = useMemo<readonly PickerOption[]>(
    () => memberActorOptions(members),
    [members],
  );

  const tabs: readonly TabsItem[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'projects', label: 'Projects' },
    { value: 'work', label: 'Work' },
    { value: 'updates', label: 'Updates' },
  ];

  // Identity alone is not enough to render: without capabilities every control would be inert
  // with nothing explaining why. Both roster keys are shared and `STALE.static`, so arriving from
  // anywhere inside the app they are already warm and this costs nothing.
  if (
    (program === null && (detailQ.isPending || recordQ.isPending)) ||
    (detail === null && membership.pending)
  ) {
    // placeholder: the program's own record — name, summary, the metric strip, detail tabs,
    // and the projects under it. The route carries only a program
    // id; even the tab row's counts come from the same read.
    //
    // Reached only on a cold open; arriving from a list or from the composer that just
    // created it, the record is cached and the real masthead renders straight away.
    return <EntityDetailSkeleton tabCount={3} label={`Loading ${programLabel.toLowerCase()}`} />;
  }

  if (detailQ.isError) {
    return (
      <PageContainer>
        <p role="alert" className="text-error text-sm">
          {userErrorMessage(detailQ.error, 'Could not load this program.')}
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
      icon={
        <span className="flex size-12 shrink-0 items-center justify-center">
          <EntityIconGlyph iconKey="layers" colorKey="primary" customColor={null} size={48} />
        </span>
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
        // what makes the publish icon and the overflow icon provably the same size (CORE-28)
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
                  className="text-error focus:text-error"
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
          items={tabs}
        />
      }
    >
      {tab === 'overview' ? (
        <div role="tabpanel" id="tabpanel-overview" aria-labelledby="tab-overview">
          <EntityDocument
            value={program.description}
            canEdit={canEdit}
            onSave={(description) => {
              patchProgram({ description });
            }}
            placeholder={`Add the ${programLabel} brief…`}
          />
        </div>
      ) : null}

      {tab === 'projects' ? (
        <div role="tabpanel" id="tabpanel-projects" aria-labelledby="tab-projects">
          <ProgramProjectsPanel
            orgId={orgId}
            programId={programId}
            programDetailKey={detailKey}
            projectNoun={projectNounCased}
            canEdit={canEdit}
            onOpenProject={(projectId) => {
              router.push(`/orgs/${orgId}/projects/${projectId}`);
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

      <ConfirmDeleteDialog
        open={confirmDeleteOpen}
        onOpenChange={(next) => {
          // Clear any prior failure so a stale message never shows on reopen.
          deleteProgram.reset();
          setConfirmDeleteOpen(next);
        }}
        title={`Delete this ${programLabel.toLowerCase()}?`}
        description={`This permanently removes "${program.name}" and unlinks its projects and work. This can't be undone.`}
        error={
          deleteProgram.error
            ? userErrorMessage(
                deleteProgram.error,
                `Could not delete this ${programLabel.toLowerCase()}.`,
              )
            : null
        }
        confirmLabel={`Delete ${programLabel.toLowerCase()}`}
        pending={deleteProgram.isPending}
        onConfirm={() => {
          deleteProgram.mutate(undefined, {
            onSuccess: () => {
              setConfirmDeleteOpen(false);
            },
          });
        }}
      />
    </EntityDetailLayout>
  );
}
