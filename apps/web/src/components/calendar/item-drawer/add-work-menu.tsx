'use client';

/**
 * `calendar/item-drawer/add-work-menu` — one way into every band of an event's arc.
 *
 * @remarks
 * This replaces a `<select aria-label="New task relationship">` that sat beside two buttons in the
 * drawer's header row. The role was a thing you set before acting, which meant reading a dropdown
 * to find out what "Prep" and "Outcome" were for. The band you are adding to now decides the role,
 * so the control says what it does and the dropdown is gone.
 */
import type { CalendarItemOut } from '@docket/planning/calendar-contract';
import { Link as LinkIcon, Plus, Workflow } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { type JSX } from 'react';

import { useCreateObject } from '@/components/create-object/create-object-provider';
import { queuedOfflineWrite } from '@/components/pwa/offline-write';

import { useLinkTaskToItem } from '../calendar-mutations';
import { ARC_BAND_ADD_LABEL, ARC_BAND_TASK_ROLE, type ArcBandId } from './arc-model';

/** Props for {@link AddWorkMenu}. */
export interface AddWorkMenuProps {
  /** The event the new work attaches to. */
  item: CalendarItemOut;
  /** Which band is asking, which is what sets the new task's role. */
  band: ArcBandId;
  /** Override the label when the affordance stands for the whole arc rather than one band. */
  label?: string | undefined;
  /** Open the link-an-existing-task form. */
  onLinkExisting: () => void;
  /** Open the plan-work form. */
  onPlanWork: () => void;
}

/** The add affordance at the foot of one arc band. */
export function AddWorkMenu({
  item,
  band,
  label,
  onLinkExisting,
  onPlanWork,
}: AddWorkMenuProps): JSX.Element {
  const { openCreate } = useCreateObject();
  const link = useLinkTaskToItem(item.id);
  const role = ARC_BAND_TASK_ROLE[band];

  const queued = queuedOfflineWrite(link.error);
  return (
    <div className="flex flex-col gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            controlSize="sm"
            className="text-on-surface-variant w-fit"
            disabled={link.isPending}
          >
            <Plus aria-hidden="true" />
            {label ?? ARC_BAND_ADD_LABEL[band]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" width="md">
          <DropdownMenuItem
            onSelect={() => {
              openCreate({
                kind: 'task',
                sameWorkspaceCompletion: 'stay',
                // The task exists whether or not the link lands, so a failed attach is the link
                // mutation's own notice (with Try again) and never fails the creation.
                afterCreate: async (task) => {
                  try {
                    await link.mutateAsync({
                      organizationId: task.organizationId,
                      taskId: task.id,
                      role,
                    });
                  } catch {
                    return;
                  }
                },
              });
            }}
          >
            <Plus aria-hidden="true" />
            New task
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onLinkExisting}>
            <LinkIcon aria-hidden="true" />
            Link an existing task
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onPlanWork}>
            <Workflow aria-hidden="true" />
            {item.recurringEventId ? 'Add tasks for each event' : 'Plan work around this event'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <LinkFeedback pending={link.isPending} queued={queued !== null} />
    </div>
  );
}

interface LinkFeedbackProps {
  readonly pending: boolean;
  readonly queued: boolean;
}

/**
 * Say where a task that was just created stands with the event.
 *
 * @remarks
 * Creating a task and attaching it are two writes, and the second can be queued offline on its
 * own. A failed attach is presented by the link mutation as a notice; the two states worth a line
 * here are the ones where nothing has failed.
 */
function LinkFeedback({ pending, queued }: LinkFeedbackProps): JSX.Element | null {
  if (pending) {
    return (
      <p role="status" className="text-on-surface-variant text-body-small px-2">
        Attaching task…
      </p>
    );
  }
  if (queued) {
    return (
      <p role="status" className="text-on-surface-variant text-body-small px-2">
        Saved on this device. Docket will sync it as soon as you&apos;re back online.
      </p>
    );
  }
  return null;
}
