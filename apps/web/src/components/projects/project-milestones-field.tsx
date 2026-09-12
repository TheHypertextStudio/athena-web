'use client';

/**
 * The Create Project composer's Milestones section — define a project's checkpoints on the way in.
 *
 * @remarks
 * Milestones used to only be addable after the project existed, which meant planning a project with
 * a known shape ("beta, then launch") took a create, a navigation, and then three more round trips
 * on the Overview tab. This declares them in the same draft as the project.
 *
 * These are *drafts*, not milestones: they have no id and nothing has been persisted, so the rows
 * hold local state and the composer's submit is what turns them into records. The note is a plain
 * {@link Textarea} rather than the rich document editor — the composer is a drafting surface and
 * already owns one body editor for the project itself; a second one per milestone row would make the
 * dialog a page. The text is stored verbatim, so it renders as Markdown the moment the milestone has
 * a detail page to render it on.
 *
 * Adding uses the shared {@link QuickAddRow}, which is the same control the Project Overview's
 * Milestones list uses, so a milestone is added the same way in both places.
 *
 * Nothing here takes a `disabled` prop: `ComposerShell` renders its trailing fields inside a
 * `<fieldset disabled={creating}>`, which disables every control below in one place.
 */
import { DatePicker } from '@docket/ui/components';
import { X } from '@docket/ui/icons';
import { Button, Input, Textarea } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { QuickAddRow } from '@/components/views/quick-add-row';
import { formatCalendarDate } from '@/lib/format-date';

/** One unsaved milestone in a Project draft. */
export interface DraftMilestone {
  /** Local identity for the row, stable across edits so React keeps the fields mounted. */
  readonly key: string;
  /** The milestone name. The add row rejects a blank, though a row can be emptied afterwards. */
  readonly name: string;
  /** The planned completion day (`YYYY-MM-DD`), or `null` for an undated checkpoint. */
  readonly targetDate: string | null;
  /** The note, empty when none was written. */
  readonly description: string;
}

/** Props for {@link ProjectMilestonesField}. */
export interface ProjectMilestonesFieldProps {
  /** The drafts, in the order they will be created (which becomes their `sort`). */
  value: readonly DraftMilestone[];
  /** Report the full next list. */
  onChange: (next: readonly DraftMilestone[]) => void;
}

/** Build a draft from a typed name, with a key unique within this composer's lifetime. */
function draftFrom(name: string): DraftMilestone {
  return {
    key: `${String(Date.now())}-${Math.random().toString(36).slice(2, 9)}`,
    name,
    targetDate: null,
    description: '',
  };
}

/** The composer's milestone list: one editable row per draft, plus an add row. */
export function ProjectMilestonesField({
  value,
  onChange,
}: ProjectMilestonesFieldProps): JSX.Element {
  /** Replace one draft in place, leaving order (and therefore `sort`) alone. */
  const update = (key: string, patch: Partial<DraftMilestone>): void => {
    onChange(value.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  };

  return (
    <section aria-label="Milestones" className="flex flex-col gap-2">
      <h3 className="text-on-surface-variant text-label-large">Milestones</h3>

      {value.map((draft) => {
        // A row can be emptied after it is added, and an aria-label interpolating the name would
        // then read "Remove ". The noun is what the row still is when it has nothing else.
        const label = draft.name.trim().length > 0 ? draft.name.trim() : 'Milestone';
        return (
          <div key={draft.key} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input
                value={draft.name}
                aria-label="Milestone name"
                placeholder="Milestone name"
                onChange={(event) => {
                  update(draft.key, { name: event.target.value });
                }}
                className="min-w-0 flex-1"
              />
              <DatePicker
                value={draft.targetDate}
                onChange={(targetDate) => {
                  update(draft.key, { targetDate });
                }}
                placeholder="Target date"
                formatLabel={(next) => formatCalendarDate(next) ?? undefined}
                ariaLabel={`${label} target date`}
                triggerVariant="ghost"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${label}`}
                onClick={() => {
                  onChange(value.filter((entry) => entry.key !== draft.key));
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
            <Textarea
              value={draft.description}
              aria-label={`${label} note`}
              placeholder="Add a note…"
              rows={2}
              onChange={(event) => {
                update(draft.key, { description: event.target.value });
              }}
            />
          </div>
        );
      })}

      <QuickAddRow
        onAdd={async (name) => {
          onChange([...value, draftFrom(name)]);
        }}
        canEdit
        noun="milestone"
      />
    </section>
  );
}
