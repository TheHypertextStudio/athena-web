'use client';

/**
 * Dialog for renaming a connected account.
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

interface RenameAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentLabel: string | null;
  accountEmail: string | null;
  onRename: (newLabel: string) => void;
  isLoading?: boolean;
}

/**
 * Dialog for renaming a connected calendar account.
 */
export function RenameAccountDialog({
  open,
  onOpenChange,
  currentLabel,
  accountEmail,
  onRename,
  isLoading = false,
}: RenameAccountDialogProps) {
  const [label, setLabel] = useState(currentLabel ?? '');

  // Reset label when dialog opens
  useEffect(() => {
    if (open) {
      setLabel(currentLabel ?? '');
    }
  }, [open, currentLabel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRename(label.trim());
  };

  const placeholder = accountEmail ? `e.g., "Work" or "Personal"` : 'Enter a label';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Account</DialogTitle>
          <DialogDescription>
            {accountEmail
              ? `Give "${accountEmail}" a friendly name to easily identify it.`
              : 'Give this account a friendly name to easily identify it.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="py-4">
            <Label htmlFor="account-label" className="text-on-surface">
              Account Label
            </Label>
            <Input
              id="account-label"
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
