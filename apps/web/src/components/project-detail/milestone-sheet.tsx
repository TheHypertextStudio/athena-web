'use client';

/**
 * Edit one of a Project's milestones, without leaving the Project.
 *
 * @remarks
 * A milestone is part of a project, not a document beside it — the data model says so (a cascading
 * `project_id` FK and no `projectId` on `MilestoneUpdate`, so the parent is fixed for life), the API
 * says so now that its routes are nested, and Linear models it the same way. So this is a side
 * panel over the project rather than a page of its own: the project stays on screen behind it, and
 * a milestone has no address, no tab, and no entry in the object registry.
 *
 * It still carries the full document editor. That was the point of giving milestones a real editing
 * surface at all — a note belongs in the same editor every other body uses, not squeezed into a list
 * row where its reserved height distorted the whole list.
 *
 * Every field autosaves, like every other editable record in the app. There is no Save button and no
 * edit-mode toggle; closing the panel is not a commit, because each change already committed itself.
 * The milestone is passed in rather than fetched: the Project's work read already carries it, so a
 * second read would only be a slower copy of what the caller is holding.
 */
import type { MilestoneOut } from '@docket/work/milestone-contract';
import { DatePicker } from '@docket/ui/components';
import { Flag, Trash2 } from '@docket/ui/icons';
import {
  Button,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@docket/ui/primitives';
import { type JSX } from 'react';

import { EditableFreeformText } from '@/components/editor/freeform-text';
import { EditableTitle } from '@/components/editor/editable-title';
import { formatCalendarDate } from '@/lib/format-date';
import { milestoneTargetDate, useMilestoneDetail } from '@/lib/use-milestone-detail';

/** Props for {@link MilestoneSheet}. */
export interface MilestoneSheetProps {
  orgId: string;
  projectId: string;
  /** The milestone being edited, or `null` when the panel is closed. */
  milestone: MilestoneOut | null;
  /** Completed / total tasks pointing at this milestone. */
  progress: { readonly done: number; readonly total: number };
  /** The vocabulary-skinned lowercase task noun. */
  taskNoun: string;
  /** Whether the viewer may edit. */
  canEdit: boolean;
  /** Close the panel. */
  onClose: () => void;
}

/** The milestone editor, anchored to the right of the Project it belongs to. */
export function MilestoneSheet({
  orgId,
  projectId,
  milestone,
  progress,
  taskNoun,
  canEdit,
  onClose,
}: MilestoneSheetProps): JSX.Element | null {
  if (milestone === null) return null;
  return (
    <MilestoneSheetBody
      orgId={orgId}
      projectId={projectId}
      milestone={milestone}
      progress={progress}
      taskNoun={taskNoun}
      canEdit={canEdit}
      onClose={onClose}
    />
  );
}

/** Props for the private {@link MilestoneSheetBody}. */
interface MilestoneSheetBodyProps extends Omit<MilestoneSheetProps, 'milestone'> {
  /** The resolved milestone — never `null` here, which is what the wrapper guarantees. */
  milestone: MilestoneOut;
}

/**
 * The open panel.
 *
 * @remarks
 * Split from the wrapper so the mutation hook is only mounted for an actual milestone, and so the
 * whole panel remounts when a different one is selected — which is what resets the document editor
 * to the new note rather than carrying the previous one's state across.
 */
function MilestoneSheetBody({
  orgId,
  projectId,
  milestone,
  progress,
  taskNoun,
  canEdit,
  onClose,
}: MilestoneSheetBodyProps): JSX.Element {
  // The hook derives the Project's work key itself — the same read this panel was opened from.
  const { patch, remove, mutationError } = useMilestoneDetail(
    orgId,
    milestone.id,
    projectId,
    onClose,
  );
  const targetDate = milestoneTargetDate(milestone);

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" size="wide">
        <SheetHeader inset="standard" className="flex-col gap-3">
          <SheetTitle asChild>
            <EditableTitle
              value={milestone.name}
              onSave={(name) => {
                patch({ name });
              }}
              canEdit={canEdit}
              ariaLabel="Milestone name"
              className="text-title-large text-on-surface"
            />
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-3">
            <DatePicker
              value={targetDate}
              onChange={(next) => {
                patch({ targetDate: next });
              }}
              placeholder="Set target date"
              formatLabel={(value) => formatCalendarDate(value) ?? undefined}
              ariaLabel="Milestone target date"
              readOnly={!canEdit}
              triggerVariant="ghost"
            />
            <span className="text-on-surface-variant text-label-large flex items-center gap-1.5 tabular-nums">
              <Flag aria-hidden className="size-4 shrink-0" />
              {progress.done}/{progress.total} {taskNoun}
              {progress.total === 1 ? '' : 's'} done
            </span>
          </div>
          {mutationError ? (
            <p role="alert" className="text-error text-body-medium">
              {mutationError}
            </p>
          ) : null}
        </SheetHeader>

        <SheetBody inset="standard" className="flex flex-col gap-4">
          <EditableFreeformText
            value={milestone.description}
            placeholder="Describe this milestone…"
            canEdit={canEdit}
            onSave={(description) => {
              patch({ description });
            }}
          />
          {canEdit ? (
            <Button
              type="button"
              variant="ghost-destructive"
              className="self-start"
              onClick={() => {
                remove();
              }}
            >
              <Trash2 className="size-4" />
              Delete milestone
            </Button>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
