'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import { Button } from '@/components/ui/button';
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
import { authApi } from '@/lib/api-client';

interface RevokeSessionButtonProps {
  sessionId: string;
}

export function RevokeSessionButton({ sessionId }: RevokeSessionButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleRevoke = () => {
    startTransition(async () => {
      await authApi.revokeSession(sessionId);
      router.refresh();
    });
  };

  return (
    <Button variant="ghost" size="icon" onClick={handleRevoke} disabled={isPending}>
      <DeleteOutlinedIcon sx={{ fontSize: 18 }} />
    </Button>
  );
}

export function RevokeAllSessionsButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleRevokeAll = () => {
    startTransition(async () => {
      await authApi.revokeAllSessions();
      router.refresh();
    });
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={isPending}>
          {isPending ? 'Signing out...' : 'Sign out of all other devices'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out everywhere?</AlertDialogTitle>
          <AlertDialogDescription>
            This will sign you out of all devices except this one. You'll need to sign in again on
            those devices.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleRevokeAll}>Sign out everywhere</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
