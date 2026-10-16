'use client';
import type { JSX } from 'react';
import type { WorkTemplateCopyReceipt } from '@docket/work/template-gallery-contract';
import { Button, Surface } from '@docket/ui/primitives';

/** Read the persisted outcome, distinguishing an undone original from a newly installed bundle. */
export function GalleryCopyResult({
  receipt,
  workspaceName,
  onOpen,
  onNew,
}: {
  readonly receipt: WorkTemplateCopyReceipt;
  readonly workspaceName: string;
  readonly onOpen: (receipt: WorkTemplateCopyReceipt) => void;
  readonly onNew: () => void;
}): JSX.Element {
  const undone = receipt.state === 'undone';
  const privateDrafts = receipt.mode === 'private_drafts';
  return (
    <Surface
      as="section"
      shape="large"
      pad="roomy"
      aria-label="Copy outcome"
      className="flex min-w-0 flex-col gap-4"
    >
      <h1 className="text-headline-medium">
        {undone
          ? 'This copy was undone'
          : privateDrafts
            ? 'Private drafts kept'
            : 'Work definitions added'}
      </h1>
      <p className="text-body-medium">
        {undone
          ? 'The original installation remains undone. Choose starting work to make a new copy.'
          : privateDrafts
            ? 'Your selected work is ready to review. Only you can see these drafts; publication is a separate action.'
            : `The published definitions are ready to use in ${workspaceName}. Existing work stays as it is.`}
      </p>
      <div className="flex flex-wrap gap-3">
        {!undone ? (
          <Button
            onClick={() => {
              onOpen(receipt);
            }}
          >
            {privateDrafts ? 'Open drafts' : 'View work definitions'}
          </Button>
        ) : null}
        <Button variant={undone ? 'default' : 'ghost'} onClick={onNew}>
          Choose starting work
        </Button>
      </div>
    </Surface>
  );
}
