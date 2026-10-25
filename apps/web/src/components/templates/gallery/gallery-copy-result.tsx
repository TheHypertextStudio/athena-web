'use client';
import type { JSX } from 'react';
import type { WorkTemplateCopyReceipt } from '@docket/work/template-gallery-contract';
import { Button, Surface } from '@docket/ui/primitives';

/** Actual copy state and its ordinary library or private review destinations. */
interface GalleryCopyResultProps {
  readonly receipt: WorkTemplateCopyReceipt;
  readonly workspaceName: string;
  readonly onOpen: (receipt: WorkTemplateCopyReceipt) => void;
  readonly onNew: () => void;
  readonly newLabel?: string;
  readonly undoneDescription?: string;
  readonly onReviewCopy?: (receipt: WorkTemplateCopyReceipt) => void;
}

/** Read the persisted outcome, distinguishing an undone original from a newly installed bundle. */
export function GalleryCopyResult(props: GalleryCopyResultProps): JSX.Element {
  const { receipt, workspaceName } = props;
  const undone = receipt.state === 'undone';
  const privateDrafts = receipt.mode === 'private_drafts';
  return (
    <Surface
      as="section"
      shape="medium"
      pad="comfortable"
      aria-label="Copy outcome"
      className="flex min-w-0 flex-col gap-4"
    >
      <h1 className="text-title-large sm:text-headline-medium">
        {undone
          ? 'This copy was undone'
          : privateDrafts
            ? 'Private drafts kept'
            : 'Templates ready to use'}
      </h1>
      <p className="text-body-medium">
        {undone
          ? (props.undoneDescription ??
            'This copy is still undone. Choose starting points to make a new copy.')
          : privateDrafts
            ? 'Your selected templates are ready to review. Only you can see these drafts. Share them when you are ready.'
            : `These templates are ready to use in ${workspaceName}. Existing work stays as it is.`}
      </p>
      <CopyResultActions {...props} />
    </Surface>
  );
}

function CopyResultActions(props: GalleryCopyResultProps): JSX.Element {
  const { receipt, onReviewCopy } = props;
  if (receipt.state === 'undone')
    return (
      <Button wrapLabel onClick={props.onNew}>
        {props.newLabel ?? 'Choose starting points'}
      </Button>
    );
  const privateDrafts = receipt.mode === 'private_drafts';
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        wrapLabel
        onClick={() => {
          props.onOpen(receipt);
        }}
      >
        {privateDrafts ? 'Open drafts' : 'View templates'}
      </Button>
      {!privateDrafts && onReviewCopy ? (
        <Button
          wrapLabel
          variant="ghost"
          onClick={() => {
            onReviewCopy(receipt);
          }}
        >
          Review this copy
        </Button>
      ) : (
        <Button wrapLabel variant="ghost" onClick={props.onNew}>
          {props.newLabel ?? 'Choose starting points'}
        </Button>
      )}
    </div>
  );
}
