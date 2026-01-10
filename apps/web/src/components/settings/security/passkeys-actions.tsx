'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { authApi } from '@/lib/api-client';
import { registerPasskey } from '@/lib/auth-client';
import { usePasskeySupport } from '@/hooks/use-passkey-support';

interface Passkey {
  id: string;
  name: string | null;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
}

interface PasskeyActionsProps {
  passkey: Passkey;
  canDelete: boolean;
}

export function PasskeyActions({ passkey, canDelete }: PasskeyActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [newName, setNewName] = useState(passkey.name ?? '');

  const handleRename = () => {
    if (!newName.trim()) return;
    startTransition(async () => {
      await authApi.renamePasskey(passkey.id, newName.trim());
      setRenameDialogOpen(false);
      router.refresh();
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      await authApi.deletePasskey(passkey.id);
      router.refresh();
    });
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setNewName(passkey.name ?? '');
            setRenameDialogOpen(true);
          }}
          disabled={isPending}
        >
          <EditOutlinedIcon sx={{ fontSize: 18 }} />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" disabled={isPending || !canDelete}>
              <DeleteOutlinedIcon sx={{ fontSize: 18 }} />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete passkey?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove "{passkey.name ?? 'this passkey'}" from your account. You won't be
                able to use it to sign in anymore.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename passkey</DialogTitle>
            <DialogDescription>
              Give this passkey a name to help you identify it later.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
            }}
            placeholder="e.g., MacBook Pro, iPhone"
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRenameDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={!newName.trim() || isPending}>
              {isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AddPasskeyButton() {
  const router = useRouter();
  const { isSupported, isLoading } = usePasskeySupport();
  const [isPending, startTransition] = useTransition();

  const handleAdd = () => {
    startTransition(async () => {
      try {
        await registerPasskey();
        router.refresh();
      } catch (error) {
        console.error('Failed to register passkey:', error);
      }
    });
  };

  if (isLoading) {
    return null;
  }

  if (!isSupported) {
    return (
      <p className="text-on-surface-variant text-sm">Your browser doesn't support passkeys.</p>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={handleAdd} disabled={isPending}>
      <AddOutlinedIcon sx={{ fontSize: 18 }} className="mr-1" />
      {isPending ? 'Adding...' : 'Add passkey'}
    </Button>
  );
}
