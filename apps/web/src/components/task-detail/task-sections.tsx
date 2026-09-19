'use client';

/**
 * The task page's active section: one tab panel at a time.
 *
 * @remarks
 * Only the section on screen is mounted, so what a tab reads from the network is not read until
 * someone opens that tab.
 */
import type { TaskDetail } from '@docket/work/task-model';
import type { QueryKey } from '@tanstack/react-query';
import type { JSX } from 'react';

import type { EntityMentionsData } from '@/lib/use-entity-mentions';
import type { TaskMutations } from '@/lib/use-task-mutations';

import type { TaskTab } from './task-masthead-slots';
import { TaskOverviewPanel } from './task-overview-panel';
import { TaskResourcesPanel } from './task-resources-panel';

/** Props for {@link TaskSections}. */
export interface TaskSectionsProps {
  readonly tab: TaskTab;
  readonly orgId: string;
  readonly task: TaskDetail;
  readonly detailKey: QueryKey;
  readonly currentActorId: string | null;
  readonly canEdit: boolean;
  readonly canComment: boolean;
  readonly mentions: EntityMentionsData;
  readonly projectName: (projectId: string) => string;
  readonly projectLabel: string;
  readonly mutations: Pick<
    TaskMutations,
    'patchTask' | 'addSubtask' | 'toggleSubtask' | 'addComment'
  >;
  readonly linkedContentOpen: boolean;
  readonly onOpenLinkedContent: () => void;
}

/**
 * Render the section the task page's tab bar has selected.
 *
 * @param props - See {@link TaskSectionsProps}.
 * @returns the section's tab panel.
 */
export function TaskSections({ tab, mentions, ...section }: TaskSectionsProps): JSX.Element {
  const { orgId, task, canEdit } = section;
  if (tab === 'resources') {
    return (
      <section role="tabpanel" id="tabpanel-resources" aria-labelledby="tab-resources">
        <TaskResourcesPanel
          orgId={orgId}
          taskId={task.id}
          canEdit={canEdit}
          description={task.description}
          mentions={mentions}
        />
      </section>
    );
  }
  return (
    <section role="tabpanel" id="tabpanel-overview" aria-labelledby="tab-overview">
      <TaskOverviewPanel taskId={task.id} {...section} />
    </section>
  );
}
