'use client';

/**
 * A Milestone's detail page.
 *
 * @remarks
 * Milestones used to be the one Docket entity with nowhere to live: everything about one happened
 * inside a card on the owning Project's Overview tab, which meant the note had to be edited by an
 * inline Markdown editor embedded in a list row. This page is where that note belongs, and it is the
 * ordinary entity-detail arrangement every other kind already uses — a masthead with an editable
 * icon, name, and property chips, then the shared document editor for the body.
 *
 * A milestone cannot be re-parented (`MilestoneUpdate` has no `projectId`), so the Project is an
 * eyebrow breadcrumb rather than a picker. The Tasks list reads the Project's work sections and
 * narrows to the tasks pointing here — there is no `milestoneId` filter on the task list, and adding
 * one would duplicate a read the Project already serves.
 *
 * The route component is only the load/error/not-found gate; {@link MilestoneDetail} is the page
 * itself and runs with the milestone already resolved, so nothing below it re-checks for `null`.
 */
import type { MilestoneOut } from '@docket/work/milestone-contract';
import { useVocabulary } from '@docket/ui/hooks';
import { ChevronRight, Ellipsis, Trash2 } from '@docket/ui/icons';
import {
  Button,
  ControlGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
} from '@docket/ui/primitives';
import { ConfirmDestructiveDialog } from '@docket/ui/components';
import { type JSX, useState } from 'react';

import Link from '@/components/docket-link';
import { EditableFreeformText } from '@/components/editor/freeform-text';
import { EditableTitle } from '@/components/editor/editable-title';
import { EntityIconPicker } from '@/components/entity-display/entity-icon-picker';
import { useEntityDisplay } from '@/components/entity-display/use-entity-display';
import { MilestonePropertiesPanel } from '@/components/milestone-detail/properties-panel';
import {
  type MilestonePageData,
  useMilestonePage,
} from '@/components/milestone-detail/use-milestone-page';
import { MilestoneTasks } from '@/components/project-detail/milestone-tasks';
import { useDocumentTitle } from '@/components/tabs/use-document-title';
import { useRegisterTabTitle } from '@/components/tabs/use-register-tab-title';
import { EntityDetailLayout, EntityMetadataRow } from '@/components/views/entity-detail-layout';
import { DetailPrintSummary } from '@/components/views/detail-print-summary';
import { EntityDetailSkeleton } from '@/components/views/entity-detail-skeleton';
import { PageContainer } from '@/components/views/page-layout';
import { useTypedRoute } from '@/lib/app-location';
import { formatCalendarDate } from '@/lib/format-date';
import { useAppRouter } from '@/lib/interactions/navigation';
import { userErrorMessage } from '@/lib/problem';
import { useMilestoneDetail } from '@/lib/use-milestone-detail';

/** MilestoneDetailPage renders the authenticated milestone page. */
export default function MilestoneDetailPage(): JSX.Element {
  const { params } = useTypedRoute('/orgs/[orgId]/milestones/[milestoneId]');
  const { orgId, milestoneId } = params;
  const page = useMilestonePage(orgId, milestoneId);

  // The tab bar and the browser tab both follow the name on screen, including through a rename.
  useRegisterTabTitle('milestone', orgId, milestoneId, page.milestone?.name);
  useDocumentTitle(page.milestone?.name);

  if (page.loading) {
    return (
      <EntityDetailSkeleton entityName="Milestone" chipCount={2} tabCount={1} hasSubtitle={false} />
    );
  }

  if (page.error !== null) {
    return (
      <PageContainer>
        <p role="alert" className="text-error text-body-medium">
          {userErrorMessage(page.error, 'Could not load this milestone.')}
        </p>
      </PageContainer>
    );
  }

  if (page.milestone === null) {
    return (
      <PageContainer>
        <p className="bg-surface-container-low text-on-surface-variant text-body-medium rounded-xl p-8 text-center">
          This milestone could not be found.
        </p>
      </PageContainer>
    );
  }

  return <MilestoneDetail orgId={orgId} milestone={page.milestone} page={page} />;
}

/** Props for {@link MilestoneDetail}. */
interface MilestoneDetailProps {
  orgId: string;
  /** The resolved milestone — never `null` here, which is what the route component guarantees. */
  milestone: MilestoneOut;
  page: MilestonePageData;
}

/** The milestone page proper, with its record already read. */
function MilestoneDetail({ orgId, milestone, page }: MilestoneDetailProps): JSX.Element {
  const router = useAppRouter();
  const taskNoun = useVocabulary('task').toLowerCase();
  const projectNoun = useVocabulary('project');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const { projectId, projectName, progress, targetDate, canEdit } = page;

  const entityDisplay = useEntityDisplay({
    organizationId: orgId,
    subjectType: 'milestone',
    subjectId: milestone.id,
    errorMessage: 'Could not load this milestone’s icon.',
  });

  const { patch, remove, mutationError } = useMilestoneDetail(
    orgId,
    milestone.id,
    projectId ?? '',
    () => {
      router.push(`/orgs/${orgId}/projects/${projectId ?? ''}`);
    },
  );

  return (
    <EntityDetailLayout
      object={{
        kind: 'milestone',
        id: milestone.id,
        organizationId: orgId,
        title: milestone.name,
      }}
      printSummary={
        <DetailPrintSummary
          title={milestone.name}
          summary={null}
          description={milestone.description}
          properties={[
            { label: 'Target date', value: formatCalendarDate(targetDate) ?? '—' },
            { label: projectNoun, value: projectName ?? '—' },
            { label: 'Progress', value: `${progress.done}/${progress.total}` },
          ]}
        />
      }
      eyebrow={
        <MilestoneBreadcrumb
          orgId={orgId}
          projectId={projectId}
          projectName={projectName}
          projectNoun={projectNoun}
        />
      }
      icon={
        <EntityIconPicker
          display={entityDisplay.display}
          entityName={milestone.name}
          editable={canEdit}
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
          value={milestone.name}
          onSave={(name) => {
            patch({ name });
          }}
          canEdit={canEdit}
          ariaLabel="Milestone name"
          className="text-headline-medium text-on-surface"
        />
      }
      metadata={
        <div className="flex flex-col gap-2">
          <EntityMetadataRow ariaLabel="Milestone properties">
            <MilestonePropertiesPanel
              targetDate={targetDate}
              onTargetDateChange={(next) => {
                patch({ targetDate: next });
              }}
              done={progress.done}
              total={progress.total}
              taskNoun={taskNoun}
              canEdit={canEdit}
            />
          </EntityMetadataRow>
          {mutationError ? (
            <p role="alert" className="text-error text-body-medium px-1">
              {mutationError}
            </p>
          ) : null}
        </div>
      }
      actions={
        canEdit ? (
          <ControlGroup controlSize="xl">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" iconOnly aria-label="Milestone actions">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" width="sm">
                <DropdownMenuItem
                  destructive
                  onSelect={() => {
                    setConfirmDeleteOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete milestone
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ControlGroup>
        ) : null
      }
      tabs={
        <Tabs
          variant="underline"
          value="overview"
          onValueChange={() => undefined}
          label="Milestone sections"
          items={[{ value: 'overview', label: 'Overview', priority: 0 }]}
        />
      }
    >
      <div
        role="tabpanel"
        id="tabpanel-overview"
        aria-labelledby="tab-overview"
        className="flex min-w-0 flex-col gap-8"
      >
        <EditableFreeformText
          value={milestone.description}
          placeholder="Describe this milestone…"
          canEdit={canEdit}
          onSave={(description) => {
            patch({ description });
          }}
        />

        {page.tasksFailed ? (
          <p role="alert" className="text-error text-body-medium">
            Could not load this milestone’s {taskNoun}s.
          </p>
        ) : null}

        <MilestoneTasks
          orgId={orgId}
          tasks={page.tasks}
          milestones={[{ id: milestone.id, name: milestone.name, targetDate }]}
          resolveActor={() => ({ name: 'Unknown', kind: 'human' as const })}
          taskNoun={taskNoun}
          onOpenTask={() => undefined}
          onCreate={() => {
            router.push(`/orgs/${orgId}/tasks?projectId=${projectId ?? ''}`);
          }}
          onQuickAdd={async () => undefined}
          onRename={() => undefined}
          canEdit={false}
        />
      </div>

      <ConfirmDestructiveDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete milestone"
        description={`${milestone.name} will be removed. Its ${taskNoun}s stay in the ${projectNoun.toLowerCase()} and lose their milestone.`}
        confirmLabel="Delete milestone"
        onConfirm={() => {
          remove();
        }}
      />
    </EntityDetailLayout>
  );
}

/** Props for {@link MilestoneBreadcrumb}. */
interface MilestoneBreadcrumbProps {
  orgId: string;
  projectId: string | null;
  projectName: string | null;
  projectNoun: string;
}

/** The owning Project, named above the masthead — a milestone is never shown out of its context. */
function MilestoneBreadcrumb({
  orgId,
  projectId,
  projectName,
  projectNoun,
}: MilestoneBreadcrumbProps): JSX.Element | null {
  if (projectId === null) return null;
  return (
    <span className="text-on-surface-variant text-label-large flex min-w-0 items-center gap-1">
      <Link
        href={`/orgs/${orgId}/projects/${projectId}`}
        className="hover:text-primary min-w-0 truncate rounded transition-colors"
      >
        {projectName ?? projectNoun}
      </Link>
      <ChevronRight aria-hidden className="size-4 shrink-0" />
    </span>
  );
}
