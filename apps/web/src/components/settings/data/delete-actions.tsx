'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { deleteAccount } from '@/lib/data-actions';

const ACCOUNT_DELETE_CONFIRMATION = 'DELETE_MY_ACCOUNT' as const;

export function DeleteActions() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleDeleteAccount = () => {
    if (deleteConfirmation !== ACCOUNT_DELETE_CONFIRMATION) {
      return;
    }

    startTransition(async () => {
      await deleteAccount(ACCOUNT_DELETE_CONFIRMATION);
      router.push('/');
    });
  };

  return (
    <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
      <AlertDialogTrigger asChild>
        <Button variant="filled" className="bg-error text-on-error hover:bg-error/90">
          <DeleteOutlinedIcon sx={{ fontSize: 18 }} className="mr-2" />
          Delete Account
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete your account and remove all
            your data from our servers.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-4">
          <Label htmlFor="delete-confirmation">
            Type <span className="font-mono font-bold">{ACCOUNT_DELETE_CONFIRMATION}</span> to
            confirm
          </Label>
          <Input
            id="delete-confirmation"
            value={deleteConfirmation}
            onChange={(e) => {
              setDeleteConfirmation(e.target.value);
            }}
            placeholder={ACCOUNT_DELETE_CONFIRMATION}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              setDeleteConfirmation('');
            }}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteAccount}
            disabled={deleteConfirmation !== ACCOUNT_DELETE_CONFIRMATION || isPending}
            className="bg-error text-on-error hover:bg-error/90"
          >
            {isPending ? 'Deleting...' : 'Delete Account'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
