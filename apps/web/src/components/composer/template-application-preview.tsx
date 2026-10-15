'use client';
import type { JSX } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';

/** Let authors retain their fields when selecting a different template during creation. */
export function TemplateApplicationPreview({
  name,
  onClose,
  onApply,
}: {
  name: string | null;
  onClose: () => void;
  onApply: (fields: boolean) => void;
}): JSX.Element {
  return (
    <Dialog
      open={name !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Use {name}</DialogTitle>
          <DialogDescription>
            Keep your current fields, or apply the template’s starting fields. Applying appends its
            document and fills empty names; it replaces status, labels and other properties. Dates
            stay unchanged.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              onApply(false);
            }}
          >
            Keep current fields
          </Button>
          <Button
            onClick={() => {
              onApply(true);
            }}
          >
            Apply starting fields
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
