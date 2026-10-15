'use client';
import type { JSX } from 'react';
import { InlineBanner } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Select,
} from '@docket/ui/primitives';
import type {
  BlueprintCreationPreview,
  BlueprintPreviewOptions,
  BlueprintPreviewSummary,
} from '@docket/work/work-template-blueprint';
import { TeamId } from '@docket/identity-access/ids';
import type { TeamOut } from '@/lib/contracts/team';

const previewDateFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
function timing(node: BlueprintPreviewSummary): string {
  const labels = { startDate: 'Starts', dueDate: 'Due', targetDate: 'Target' };
  return (
    (Object.keys(labels) as (keyof typeof labels)[])
      .flatMap((field) => {
        const date = node.dates[field];
        // Civil dates must not move a day when the browser uses another timezone.
        if (date)
          return [`${labels[field]} ${previewDateFormatter.format(new Date(`${date}T12:00:00Z`))}`];
        const reason = node.unresolvedReasons[field];
        if (reason === 'waiting_completion')
          return [`${labels[field]} after prerequisite work is completed`];
        if (reason === 'missing_anchor')
          return [`${labels[field]}: waiting for a parent or milestone date`];
        return [];
      })
      .join(' · ') || 'No dates'
  );
}

interface PreviewProps {
  open: boolean;
  preview: BlueprintCreationPreview | null;
  options: BlueprintPreviewOptions;
  pending: boolean;
  error: string | null;
  teams: readonly TeamOut[];
  teamless: boolean;
  onClose: () => void;
  onChange: (options: BlueprintPreviewOptions) => void;
  onPage: (offset: number) => void;
  onAccept: () => void;
}

/** Review bounded child summaries and explicitly choose optional work before the root is saved. */
export function BlueprintCreationPreviewDialog({
  open,
  preview,
  options,
  pending,
  error,
  teams,
  teamless,
  onClose,
  onChange,
  onPage,
  onAccept,
}: PreviewProps): JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        presentation={{ kind: 'responsive-fullscreen', size: 'large', height: 'content' }}
      >
        <DialogHeader>
          <DialogTitle>Included work</DialogTitle>
          <DialogDescription>
            Review what will be created with this item. Choose any optional work before creating it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {teamless ? (
            <CreationTeamField
              options={options}
              pending={pending}
              teams={teams}
              onChange={onChange}
            />
          ) : null}
          {error ? (
            <InlineBanner tone="critical" title="Could not review included work">
              {error}
            </InlineBanner>
          ) : null}
          {preview ? (
            <BlueprintReviewBody
              preview={preview}
              options={options}
              pending={pending}
              onChange={onChange}
              onPage={onPage}
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Back to draft
          </Button>
          <Button disabled={pending || !preview || !!error} onClick={onAccept}>
            Keep these choices
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreationTeamField({
  options,
  pending,
  teams,
  onChange,
}: Pick<PreviewProps, 'options' | 'pending' | 'teams' | 'onChange'>): JSX.Element {
  return (
    <Field
      label="Team for included work"
      description="Children can use this team when their parent has none."
    >
      <Select
        value={options.creationTeamId ?? ''}
        disabled={pending}
        onChange={(event) => {
          const { creationTeamId: _previous, ...rest } = options;
          onChange(
            event.target.value
              ? { ...rest, creationTeamId: TeamId.parse(event.target.value) }
              : rest,
          );
        }}
      >
        <option value="">No fallback team</option>
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function BlueprintReviewBody({
  preview,
  options,
  pending,
  onChange,
  onPage,
}: Pick<PreviewProps, 'options' | 'pending' | 'onChange' | 'onPage'> & {
  preview: BlueprintCreationPreview;
}): JSX.Element {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-3">
      <p>
        {preview.selectedCount} work items selected
        {preview.additionalMilestoneCount
          ? `, including ${preview.additionalMilestoneCount} drafted checkpoints`
          : ''}
        , including the item you are creating.
      </p>
      <BlueprintChildRows
        preview={preview}
        options={options}
        pending={pending}
        onChange={onChange}
      />
      {preview.warnings.length ? (
        <p role="status">
          Some assignments or dates need attention.{' '}
          {preview.warnings.reduce((count, warning) => count + warning.count, 0)} affected fields or
          children.
        </p>
      ) : null}
      <div className="flex gap-2">
        {preview.summaryOffset > 0 ? (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              onPage(Math.max(0, preview.summaryOffset - 499));
            }}
          >
            Previous children
          </Button>
        ) : null}
        {preview.nextSummaryOffset !== null ? (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              onPage(preview.nextSummaryOffset ?? 0);
            }}
          >
            More children
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function BlueprintChildRows({
  preview,
  options,
  pending,
  onChange,
}: Pick<PreviewProps, 'options' | 'pending' | 'onChange'> & {
  preview: BlueprintCreationPreview;
}): JSX.Element {
  const labels = {
    program: useVocabulary('program'),
    project: useVocabulary('project'),
    task: useVocabulary('task'),
    milestone: 'Milestone',
  };
  return (
    <ul className="flex min-w-0 flex-col gap-3">
      {preview.descendants.map((node) => (
        <li key={JSON.stringify(node.path)} className="flex min-w-0 items-start gap-3">
          {node.optional ? (
            <Checkbox
              aria-label={`Include ${node.title}`}
              checked={
                options.optionalChoices.find(
                  (choice) => JSON.stringify(choice.path) === JSON.stringify(node.path),
                )?.selected ?? node.selected
              }
              disabled={pending}
              onChange={(event) => {
                const key = JSON.stringify(node.path);
                onChange({
                  ...options,
                  optionalChoices: [
                    ...options.optionalChoices.filter(
                      (choice) => JSON.stringify(choice.path) !== key,
                    ),
                    { path: node.path, selected: event.target.checked },
                  ],
                });
              }}
            />
          ) : null}
          <span className="min-w-0 break-words">
            <span className="block">{node.title}</span>
            <span className="text-body-small text-on-surface-variant">
              {labels[node.kind]} · {node.selected ? timing(node) : 'Not selected'}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
