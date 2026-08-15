'use client';

/**
 * The property row a task *template* offers.
 *
 * @remarks
 * Deliberately not `TaskComposerPickers`. Almost every control in the create composer's strip
 * names a row — a team, an assignee, a project, a milestone, a cycle — or a date, and a template
 * stores neither: both go stale, and a template that fails to apply is worse than one that asks
 * for a click. Workflow status is excluded for a third reason: a state key belongs to one team's
 * workflow, so an org-wide template cannot hold one that is right for every team applying it.
 *
 * What is left is priority, and that is the honest answer rather than a thin one. Where a task
 * template earns its keep is the body outline, not the properties.
 */
import type { Priority } from '@docket/work/task-contract';
import { EnumPicker } from '@docket/ui/components';
import type { JSX } from 'react';

import { PRIORITY_OPTIONS } from '@/components/pickers/options';

/** Props for {@link TaskTemplatePickers}. */
export interface TaskTemplatePickersProps {
  /** The pre-filled priority. */
  priority: Priority;
  /** Report a changed priority. */
  onPriorityChange: (priority: Priority) => void;
  /** Whether a save is in flight, which disables every control. */
  disabled: boolean;
}

/**
 * The task template's inline property pickers.
 *
 * @param props - The {@link TaskTemplatePickersProps}.
 * @returns the rendered pickers.
 */
export function TaskTemplatePickers({
  priority,
  onPriorityChange,
  disabled,
}: TaskTemplatePickersProps): JSX.Element {
  return (
    <EnumPicker
      options={PRIORITY_OPTIONS}
      value={priority}
      onChange={(next) => {
        onPriorityChange(next ?? 'none');
      }}
      placeholder="Priority"
      ariaLabel="Priority"
      disabled={disabled}
    />
  );
}
