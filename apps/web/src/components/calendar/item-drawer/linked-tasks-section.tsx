'use client';

import type { CalendarItemLinkedTaskOut, CalendarItemOut } from '@docket/types';
import { Link as LinkIcon, Plus } from '@docket/ui/icons';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useState } from 'react';

import { useDetachTaskFromItem } from '../calendar-mutations';
import {
  CANCEL_CLASS,
  DESTRUCTIVE_CONFIRM_CLASS,
  TASK_ROLE_LABEL,
  TASK_ROLE_ORDER,
} from './presentation';
import { CreateTaskForm, LinkTaskForm } from './task-forms';

/** Props for {@link LinkedTasksSection}. */
export interface LinkedTasksSectionProps {
  /** Calendar item whose linked tasks are rendered. */
  item: CalendarItemOut;
  /** Navigate to a linked task detail page. */
  onOpenTask: (orgId: string, taskId: string) => void;
}

/** Grouped linked-task stack with create, link, open, and detach actions. */
export function LinkedTasksSection({ item, onOpenTask }: LinkedTasksSectionProps): JSX.Element {
  const [showCreate, setShowCreate] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const grouped = TASK_ROLE_ORDER.map((role) => ({
    role,
    links: item.linkedTasks.filter((link) => link.role === role),
  })).filter((group) => group.links.length > 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-on-surface text-sm font-semibold">Linked tasks</h3>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowCreate((value) => !value);
              setShowLink(false);
            }}
          >
            <Plus /> New
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowLink((value) => !value);
              setShowCreate(false);
            }}
          >
            <LinkIcon /> Link
          </Button>
        </div>
      </div>

      {grouped.length === 0 ? (
        <p className="text-on-surface-variant text-xs">No linked tasks yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {grouped.map(({ role, links }) => (
            <div key={role} className="flex flex-col gap-1.5">
              <p className="text-on-surface-variant text-xs font-medium">{TASK_ROLE_LABEL[role]}</p>
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

      {showCreate ? (
        <CreateTaskForm
          itemId={item.id}
          fallbackTitle={item.title}
          onDone={() => {
            setShowCreate(false);
          }}
        />
      ) : null}
      {showLink ? (
        <LinkTaskForm
          itemId={item.id}
          onDone={() => {
            setShowLink(false);
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

  return (
    <div className="border-outline-variant bg-surface-container-low flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
      <button
        type="button"
        onClick={() => {
          onOpenTask(link.organizationId, link.taskId);
        }}
        className={cn(
          'focus-visible:ring-ring min-w-0 flex-1 truncate rounded-sm text-left text-sm focus-visible:ring-2 focus-visible:outline-none',
          link.done ? 'text-on-surface-variant line-through' : 'text-on-surface',
        )}
      >
        {link.title}
      </button>
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
