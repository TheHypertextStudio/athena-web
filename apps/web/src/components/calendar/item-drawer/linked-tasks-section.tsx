'use client';

import type {
  CalendarItemLinkedTaskOut,
  CalendarItemOut,
  CalendarItemTaskRole,
} from '@docket/types';
import { Link as LinkIcon, Plus, Workflow } from '@docket/ui/icons';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
} from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useState } from 'react';

import { useCreateObject } from '@/components/create-object/create-object-provider';
import { EditableTitle } from '@/components/editor/editable-title';
import { queuedOfflineWrite } from '@/components/pwa/offline-write';
import { PlanWorkForEventForm } from '@/components/recurrence/plan-work-for-event-form';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, STALE, useApiListQuery } from '@/lib/query';
import { UserFacingError, userErrorMessage } from '@/lib/problem';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useRenameTask } from '@/lib/use-rename-task';

import { useDetachTaskFromItem, useLinkTaskToItem } from '../calendar-mutations';
import {
  CANCEL_CLASS,
  DESTRUCTIVE_CONFIRM_CLASS,
  TASK_ROLE_LABEL,
  TASK_ROLE_ORDER,
} from './presentation';
import { LinkTaskForm } from './task-forms';

/** Props for {@link LinkedTasksSection}. */
export interface LinkedTasksSectionProps {
  /** Calendar item whose linked tasks are rendered. */
  item: CalendarItemOut;
  /** Navigate to a linked task detail page. */
  onOpenTask: (orgId: string, taskId: string) => void;
}

/** Grouped linked-task stack with create, link, open, and detach actions. */
export function LinkedTasksSection({ item, onOpenTask }: LinkedTasksSectionProps): JSX.Element {
  const [showLink, setShowLink] = useState(false);
  const [newTaskRole, setNewTaskRole] = useState<CalendarItemTaskRole>('related');
  const { openCreate } = useCreateObject();
  const linkCreatedTask = useLinkTaskToItem(item.id);
  const queuedLink = queuedOfflineWrite(linkCreatedTask.error);
  const [showPlan, setShowPlan] = useState(false);
  const grouped = TASK_ROLE_ORDER.map((role) => ({
    role,
    links: item.linkedTasks.filter((link) => link.role === role),
  })).filter((group) => group.links.length > 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-on-surface text-title-small">Tasks</h3>
        <div className="flex flex-wrap gap-1">
          <Select
            aria-label="New task relationship"
            value={newTaskRole}
            className="h-8 min-w-0 flex-1 sm:w-28 sm:flex-none"
            disabled={linkCreatedTask.isPending}
            onChange={(event) => {
              setNewTaskRole(event.target.value as CalendarItemTaskRole);
            }}
          >
            {TASK_ROLE_ORDER.map((role) => (
              <option key={role} value={role}>
                {TASK_ROLE_LABEL[role]}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={linkCreatedTask.isPending}
            onClick={() => {
              setShowLink(false);
              openCreate({
                kind: 'task',
                sameWorkspaceCompletion: 'stay',
                afterCreate: async (task) => {
                  try {
                    await linkCreatedTask.mutateAsync({
                      organizationId: task.organizationId,
                      taskId: task.id,
                      role: newTaskRole,
                    });
                  } catch (cause) {
                    if (queuedOfflineWrite(cause)) return;
                    throw new UserFacingError(
                      'The task was created, but we could not link it to this calendar item. Open the created task to copy its ID, then return to Calendar and use Link.',
                      { cause },
                    );
                  }
                },
              });
              setShowPlan(false);
            }}
          >
            <Plus /> Create task
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowLink((value) => !value);
              setShowPlan(false);
            }}
          >
            <LinkIcon /> Link task
          </Button>
        </div>
      </div>

      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() => {
          setShowPlan((value) => !value);
          setShowLink(false);
        }}
      >
        <Workflow />
        {item.recurringEventId ? 'Add tasks for each event' : 'Plan work around this event'}
      </Button>

      {grouped.length === 0 ? (
        <p className="text-on-surface-variant text-body-small">
          No tasks are linked to this event.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {grouped.map(({ role, links }) => (
            <div key={role} className="flex flex-col gap-1.5">
              <p className="text-on-surface-variant text-label-medium">{TASK_ROLE_LABEL[role]}</p>
              <div className="flex flex-col gap-1.5">
                {links.map((link) => (
                  <LinkedTaskRow
                    key={link.taskId}
                    itemId={item.id}
                    link={link}
                    onOpenTask={onOpenTask}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {linkCreatedTask.isPending ? (
        <p role="status" className="text-on-surface-variant text-body-small">
          Linking task…
        </p>
      ) : null}
      {queuedLink ? (
        <p role="status" className="text-on-surface-variant text-body-small">
          {userErrorMessage(
            queuedLink,
            "Saved on this device. Docket will sync it as soon as you're back online.",
          )}
        </p>
      ) : linkCreatedTask.isError ? (
        <p role="alert" className="text-error text-body-small">
          The task was created, but we couldn&apos;t link it to this calendar item. Please try Link.
        </p>
      ) : null}
      {showLink ? (
        <LinkTaskForm
          itemId={item.id}
          onDone={() => {
            setShowLink(false);
          }}
        />
      ) : null}
      {showPlan ? (
        <PlanWorkForEventForm
          item={item}
          onDone={() => {
            setShowPlan(false);
          }}
        />
      ) : null}
    </section>
  );
}

interface LinkedTaskRowProps {
  itemId: string;
  link: CalendarItemLinkedTaskOut;
  onOpenTask: (orgId: string, taskId: string) => void;
}

function LinkedTaskRow({ itemId, link, onOpenTask }: LinkedTaskRowProps): JSX.Element {
  const detach = useDetachTaskFromItem(itemId, link.taskId);
  const [confirming, setConfirming] = useState(false);

  // Linked tasks can belong to any workspace, so the viewer's edit capability is resolved per row's
  // org; React Query dedupes these fetches by key. A rename refreshes the calendar item's cache so
  // its linked-task titles re-render.
  const membersQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.members(link.organizationId),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId: link.organizationId } }),
      'Could not load members.',
      { staleTime: STALE.static },
    ),
  );
  const rolesQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.roles(link.organizationId),
      () => api.v1.orgs[':orgId'].roles.$get({ param: { orgId: link.organizationId } }),
      'Could not load roles.',
      { staleTime: STALE.static },
    ),
  );
  const canEdit = useOrgCapability(
    membersQ.data?.items ?? [],
    rolesQ.data?.items ?? [],
    'contribute',
  );
  const rename = useRenameTask(link.organizationId, [queryKeys.calendarItem(itemId)]);

  const titleClass = cn(
    'min-w-0 flex-1 truncate text-left text-body-medium',
    link.done ? 'text-on-surface-variant line-through' : 'text-on-surface',
  );

  return (
    <div className="border-outline-variant bg-surface-container-low flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
      {canEdit ? (
        <EditableTitle
          value={link.title}
          onSave={(title) => {
            rename(link.taskId, title);
          }}
          canEdit
          activate="doubleClick"
          onActivate={() => {
            onOpenTask(link.organizationId, link.taskId);
          }}
          ariaLabel="Task title"
          className={titleClass}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            onOpenTask(link.organizationId, link.taskId);
          }}
          className={cn(
            'focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none',
            titleClass,
          )}
        >
          {link.title}
        </button>
      )}
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Detach ${link.title}`}
        onClick={() => {
          setConfirming(true);
        }}
        disabled={detach.isPending}
      >
        Detach
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showClose={false}>
          <DialogHeader>
            <DialogTitle>Detach &ldquo;{link.title}&rdquo;?</DialogTitle>
            <DialogDescription>
              The task stays as-is; only its link to this calendar item is removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose className={CANCEL_CLASS}>Cancel</DialogClose>
            <button
              type="button"
              className={DESTRUCTIVE_CONFIRM_CLASS}
              onClick={() => {
                detach.mutate(undefined);
                setConfirming(false);
              }}
            >
              Detach
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
