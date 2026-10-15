'use client';
import type { WorkTemplateChildChange } from '@docket/work/work-template-reference';
import type { BlueprintPreviewWarning } from '@docket/work/work-template-blueprint';
import { WorkTemplateCaptureWarnings } from './work-template-capture-warnings';
import { Checkbox } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** Keep a person's checkbox intention across refreshed opaque IDs for the same logical change. */
export function templateChildChoiceKey(change: WorkTemplateChildChange): string {
  return 'blockerPath' in change
    ? JSON.stringify([change.kind, change.blockerPath, change.blockedPath])
    : JSON.stringify([
        change.kind,
        change.path,
        change.kind === 'set_derived_date' ? change.field : null,
      ]);
}
function label(change: WorkTemplateChildChange): string {
  switch (change.kind) {
    case 'add_child':
      return `Add ${change.children[0]?.title ?? 'work'} (${String(change.count)} ${change.count === 1 ? 'item' : 'items'})`;
    case 'set_derived_date':
      return `${change.field === 'dueDate' ? 'Due date' : change.field === 'startDate' ? 'Start date' : 'Target date'} for ${change.title}`;
    case 'cancel_removed_child':
      return `Cancel ${change.title}`;
    case 'add_dependency':
      return `Add dependency: ${change.blockerTitle} → ${change.blockedTitle}`;
    case 'remove_dependency':
      return `Remove dependency: ${change.blockerTitle} → ${change.blockedTitle}`;
  }
}

/** Review each authorized subtree, relative date, dependency and default-off safe cancellation. */
export function WorkTemplateChildChanges({
  changes,
  warnings,
  choices,
  pending,
  onToggle,
}: {
  readonly warnings: readonly BlueprintPreviewWarning[];
  readonly changes: readonly WorkTemplateChildChange[];
  readonly choices: ReadonlyMap<string, boolean>;
  readonly pending: boolean;
  readonly onToggle: (change: WorkTemplateChildChange) => void;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <WorkTemplateCaptureWarnings warnings={warnings} intent="adoption" />
      {changes.map((change) => (
        <div key={change.changeId} className="flex min-w-0 flex-col gap-2">
          <label className="text-label-large flex min-h-10 cursor-pointer items-center gap-2">
            <Checkbox
              aria-label={label(change)}
              checked={choices.get(templateChildChoiceKey(change)) ?? change.selectedByDefault}
              disabled={pending}
              onChange={() => {
                onToggle(change);
              }}
            />
            {label(change)}
          </label>
          {change.kind === 'set_derived_date' ? (
            <p className="text-body-small text-on-surface-variant">
              {change.previous ?? 'Undated'} → {change.value ?? 'Undated'}
            </p>
          ) : null}
          {change.kind === 'cancel_removed_child' ? (
            <p className="text-body-small text-on-surface-variant">
              Kept unless you select cancellation. Authored notes stay.
            </p>
          ) : null}
          {change.kind === 'add_child' ? (
            <ul className="text-body-small flex min-w-0 flex-col gap-1">
              {change.children.map((child) => (
                <li key={JSON.stringify(child.path)} className="break-words">
                  {child.title}
                  {child.optional &&
                  !child.selected &&
                  JSON.stringify(child.path) !== JSON.stringify(change.path) ? (
                    <span className="text-on-surface-variant"> Optional · Not included</span>
                  ) : null}
                  {Object.entries(child.dates).map(([field, value]) => (
                    <span key={field} className="text-on-surface-variant">
                      {' '}
                      · {field === 'dueDate'
                        ? 'Due'
                        : field === 'startDate'
                          ? 'Starts'
                          : 'Target'}{' '}
                      {value ?? 'undated'}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}
