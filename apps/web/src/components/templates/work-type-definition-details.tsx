'use client';

import type { WorkTemplateDisplay } from '@docket/work/work-template-reference';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';
import type { JSX } from 'react';
import { workTypeDisplayName } from './work-type-name';

/** Explicit definition provenance and authoring actions, separate from the work's type label. */
export function WorkTypeDefinitionDetails({
  current,
  familyName,
  open,
  onOpenChange,
  onCloseAutoFocus,
  onUpdate,
  onCapture,
}: {
  readonly current: WorkTemplateDisplay | undefined;
  readonly familyName: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCloseAutoFocus: (event: Event) => void;
  readonly onUpdate: (() => void) | undefined;
  readonly onCapture: (() => void) | undefined;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Type definition details</DialogTitle>
          <DialogDescription>
            The revision belongs to the saved definition, not to this work.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {current ? (
            <>
              <p>
                {workTypeDisplayName(current, familyName)}
                {current.isBase ? ' · Default definition' : ''}
              </p>
              <p className="text-on-surface-variant text-body-medium">
                Definition revision {current.versionNumber}
                {current.archived ? ' · Archived definition' : ''}
              </p>
            </>
          ) : null}
          {onUpdate ? (
            <Button type="button" variant="secondary" onClick={onUpdate}>
              Review definition update
            </Button>
          ) : null}
          {onCapture ? (
            <Button type="button" variant="secondary" onClick={onCapture}>
              Save as template
            </Button>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
