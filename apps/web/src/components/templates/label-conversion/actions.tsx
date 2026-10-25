import type { JSX } from 'react';
import type { LabelTemplateConversionChoices } from '@docket/work/work-template-contract';
import { Button } from '@docket/ui/primitives';
import type { ConversionCommand } from './types';
const actionClass = 'h-auto min-h-10 max-w-full whitespace-normal break-words';
/** Keep review and confirmation in the same visible action area at every list length and text size. */
export function ConversionActions({
  command,
  choices,
  count,
}: {
  readonly command: ConversionCommand;
  readonly choices: LabelTemplateConversionChoices | null;
  readonly count: number;
}): JSX.Element {
  if (command.review)
    return (
      <div className="flex justify-end">
        <Button
          className={actionClass}
          disabled={command.pending || !choices}
          onClick={() => {
            if (choices) void command.confirm(choices);
          }}
        >
          {command.pending ? 'Applying…' : 'Apply template'}
        </Button>
      </div>
    );
  return (
    <div className="flex justify-end">
      <Button
        className={actionClass}
        disabled={command.pending || !choices}
        onClick={() => {
          if (choices) void command.prepareReview(choices);
        }}
      >
        {command.pending
          ? 'Preparing review…'
          : count
            ? `Review ${count} ${count === 1 ? 'item' : 'items'}`
            : 'Review selection'}
      </Button>
    </div>
  );
}
/** A known receipt remains available until the person explicitly starts another batch. */
export function ConversionResultActions({
  command,
}: {
  readonly command: ConversionCommand;
}): JSX.Element {
  return (
    <div className="flex justify-end">
      {command.receipt?.state === 'converted' ? (
        <Button
          variant="secondary"
          className={actionClass}
          disabled={command.pending}
          onClick={() => void command.undo()}
        >
          {command.pending ? 'Undoing…' : 'Undo this batch'}
        </Button>
      ) : (
        <Button
          variant="ghost"
          className={actionClass}
          disabled={command.pending}
          onClick={command.reset}
        >
          Choose more work
        </Button>
      )}
    </div>
  );
}
