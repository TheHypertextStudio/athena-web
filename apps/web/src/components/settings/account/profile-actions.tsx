'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateSettings } from '@/lib/account-actions';

interface ProfileActionsProps {
  initialPreferredName: string | null;
}

export function ProfileActions({ initialPreferredName }: ProfileActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [preferredName, setPreferredName] = useState(initialPreferredName ?? '');
  const [hasChanges, setHasChanges] = useState(false);

  const handleNameChange = (value: string) => {
    setPreferredName(value);
    setHasChanges(value !== (initialPreferredName ?? ''));
  };

  const handleSave = () => {
    startTransition(async () => {
      await updateSettings({ preferredName: preferredName || null });
      setHasChanges(false);
    });
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="preferredName">Preferred Name</Label>
      <div className="flex gap-2">
        <Input
          id="preferredName"
          placeholder="What should Athena call you?"
          value={preferredName}
          onChange={(e) => {
            handleNameChange(e.target.value);
          }}
          className="max-w-xs"
        />
        {hasChanges && (
          <Button onClick={handleSave} disabled={isPending} size="sm">
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        This is how Athena will address you in the app.
      </p>
    </div>
  );
}
