'use client';

/**
 * Dialog for editing a calendar connection label.
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface EditConnectionLabelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLabel: string | null;
  connectionEmail: string | null;
  onSave: (newLabel: string) => void;
  isLoading?: boolean;
}

/**
 * Dialog for editing a calendar connection's display label.
 *
 * @param props - Edit connection label dialog props.
 */
export function EditConnectionLabelDialog({
  open,
  onOpenChange,
  currentLabel,
  connectionEmail,
  onSave,
  isLoading = false,
}: EditConnectionLabelDialogProps) {
  const [label, setLabel] = useState(currentLabel ?? '');

  // Reset label when dialog opens
  useEffect(() => {
    if (open) {
      setLabel(currentLabel ?? '');
    }
  }, [open, currentLabel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(label.trim());
  };

  const placeholder = connectionEmail ? `e.g., "Work" or "Personal"` : 'Enter a label';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Connection</DialogTitle>
          <DialogDescription>
            {connectionEmail
              ? `Give "${connectionEmail}" a friendly name to easily identify it.`
              : 'Give this connection a friendly name to easily identify it.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="py-4">
            <Label htmlFor="connection-label" className="text-on-surface">
              Connection Label
            </Label>
            <Input
              id="connection-label"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
              }}
              placeholder={placeholder}
              maxLength={100}
              className="mt-2"
              autoFocus
            />
            <p className="text-on-surface-variant mt-1 text-xs">{label.length}/100 characters</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="text"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" variant="filled" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
