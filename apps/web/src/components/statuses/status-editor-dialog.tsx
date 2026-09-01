'use client';

/**
 * Create or edit one status.
 *
 * @remarks
 * The preview is the point of the dialog. A status is a name plus a category, and the category is
 * what decides the glyph, the colour, and whether work sitting here counts as finished — none of
 * which a name tells you. Rendering the row exactly as a task list will render it means the choice
 * is made against the thing itself.
 *
 * The category picker warns rather than blocks when a change would move work across the finished
 * line, because that is usually the intent ("Shipped should count as done") and occasionally a
 * costly accident.
 */
import type { WorkStatusCategory } from '@docket/work/work-status-contract';
import { WORK_STATUS_CATEGORIES } from '@docket/work/work-status-contract';
import { StatusIcon } from '@docket/ui/components';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Textarea,
} from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useEffect, useState } from 'react';

import { CATEGORY_DESCRIPTION, CATEGORY_LABEL, isEnded } from '@/lib/work-category';
import { userErrorMessage } from '@/lib/problem';

import type { StatusLike } from './status-registry';

/** Props for {@link StatusEditorDialog}. */
export interface StatusEditorDialogProps {
  /** The status being edited, or null when creating. */
  status: StatusLike | null;
  /** The category a newly created status lands in. */
  initialCategory: WorkStatusCategory;
  /** What this set is called, for the dialog title. */
  entityLabel: string;
  /** Whether a save is in flight. */
  pending: boolean;
  /** The failure from the last attempt, if any. */
  error: unknown;
  /** Save the status. */
  onSave: (input: {
    name: string;
    description: string | null;
    category: WorkStatusCategory;
  }) => void;
  /** Close without saving. */
  onClose: () => void;
}

/**
 * Render the create/edit dialog for one status.
 *
 * @param props - The status under edit and the save handlers.
 * @returns the dialog element.
 */
export function StatusEditorDialog({
  status,
  initialCategory,
  entityLabel,
  pending,
  error,
  onSave,
  onClose,
}: StatusEditorDialogProps): JSX.Element {
  const [name, setName] = useState(status?.name ?? '');
  const [description, setDescription] = useState(status?.description ?? '');
  const [category, setCategory] = useState<WorkStatusCategory>(status?.category ?? initialCategory);

  useEffect(() => {
    setName(status?.name ?? '');
    setDescription(status?.description ?? '');
    setCategory(status?.category ?? initialCategory);
  }, [status, initialCategory]);

  const trimmed = name.trim();
  const crossesTheLine = status !== null && isEnded(status.category) !== isEnded(category);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{status === null ? `New ${entityLabel} status` : 'Edit status'}</DialogTitle>
          <DialogDescription>
            A status is a name and a category. The category decides how it looks and whether work
            here counts as finished.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed === '') return;
            onSave({
              name: trimmed,
              description: description.trim() === '' ? null : description.trim(),
              category,
            });
          }}
        >
          <Field label="Name">
            <Input
              autoFocus
              value={name}
              maxLength={60}
              onChange={(event) => {
                setName(event.target.value);
              }}
              placeholder="In Review"
            />
          </Field>

          <Field
            label="What it means"
            description="Shown when someone is choosing between statuses."
          >
            <Textarea
              value={description}
              maxLength={280}
              rows={2}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              placeholder="Waiting on a second pair of eyes."
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-on-surface text-label-large mb-1">Category</legend>
            <div className="flex flex-col gap-1">
              {WORK_STATUS_CATEGORIES.map((option) => (
                <label
                  key={option}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                    option === category
                      ? 'bg-secondary-container text-on-secondary-container'
                      : 'hover:bg-surface-container',
                  )}
                >
                  <input
                    type="radio"
                    name="category"
                    value={option}
                    checked={option === category}
                    onChange={() => {
                      setCategory(option);
                    }}
                    className="sr-only"
                  />
                  <StatusIcon type={option} label={CATEGORY_LABEL[option]} />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-label-large">{CATEGORY_LABEL[option]}</span>
                    <span className="text-body-small opacity-80">
                      {CATEGORY_DESCRIPTION[option]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {crossesTheLine ? (
            <p role="status" className="text-on-surface-variant text-body-small">
              {isEnded(category)
                ? 'Work already in this status will be recorded as ended, which changes progress and capacity.'
                : 'Work already in this status will be reopened, which changes progress and capacity.'}
            </p>
          ) : null}

          <div className="bg-surface-container-low flex items-center gap-3 rounded-lg px-3 py-2.5">
            <StatusIcon
              type={category}
              label={trimmed === '' ? CATEGORY_LABEL[category] : trimmed}
            />
            <span className="text-on-surface text-label-large truncate">
              {trimmed === '' ? 'Preview' : trimmed}
            </span>
          </div>

          {error === null || error === undefined ? null : (
            <p role="alert" className="text-error text-body-small">
              {userErrorMessage(error, 'That status could not be saved.')}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={trimmed === '' || pending}>
              {status === null ? 'Add status' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
