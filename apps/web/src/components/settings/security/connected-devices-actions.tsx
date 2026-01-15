'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import CheckOutlinedIcon from '@mui/icons-material/CheckOutlined';
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
import { appPasswordsApi, type AppPassword } from '@/lib/api-client';
import { env } from '@/lib/env';

interface ConnectedDeviceActionsProps {
  device: AppPassword;
}

export function ConnectedDeviceActions({ device }: ConnectedDeviceActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [newName, setNewName] = useState(device.name);

  const handleRename = () => {
    if (!newName.trim()) return;
    startTransition(async () => {
      await appPasswordsApi.update(device.id, { name: newName.trim() });
      setRenameDialogOpen(false);
      router.refresh();
    });
  };

  const handleRevoke = () => {
    startTransition(async () => {
      await appPasswordsApi.delete(device.id);
      router.refresh();
    });
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="text"
          size="icon"
          onClick={() => {
            setNewName(device.name);
            setRenameDialogOpen(true);
          }}
          disabled={isPending}
        >
          <EditOutlinedIcon sx={{ fontSize: 18 }} />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="text" size="icon" disabled={isPending}>
              <DeleteOutlinedIcon sx={{ fontSize: 18 }} />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke device access?</AlertDialogTitle>
              <AlertDialogDescription>
                "{device.name}" will immediately lose access to your calendars and contacts. You'll
                need to set up a new app password to reconnect this device.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleRevoke}>Revoke Access</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename device</DialogTitle>
            <DialogDescription>
              Give this device a name to help you identify it later.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
            }}
            placeholder="e.g., iPhone Calendar, MacBook"
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="text"
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

const DEVICE_PRESET_NAMES = [
  'iPhone Calendar',
  'iPad Calendar',
  'MacBook Calendar',
  'Thunderbird',
] as const;

export function AddDeviceButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<'name' | 'password'>('name');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = () => {
    if (!deviceName.trim()) return;
    startTransition(async () => {
      const result = await appPasswordsApi.create({ name: deviceName.trim() });
      setGeneratedPassword(result.data.password);
      setStep('password');
    });
  };

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const handleClose = () => {
    setDialogOpen(false);
    setStep('name');
    setDeviceName('');
    setGeneratedPassword(null);
    setCopied(false);
    if (step === 'password') {
      router.refresh();
    }
  };

  // Get the CalDAV server URL from the API URL (strip /api if present)
  const serverUrl = env.API_URL.replace(/\/api$/, '').replace(/^https?:\/\//, '');

  return (
    <>
      <Button
        variant="outlined"
        size="sm"
        onClick={() => {
          setDialogOpen(true);
        }}
        disabled={isPending}
      >
        <AddOutlinedIcon sx={{ fontSize: 18 }} className="mr-1" />
        Add device
      </Button>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <DialogContent className="max-w-md">
          {step === 'name' ? (
            <>
              <DialogHeader>
                <DialogTitle>Add a device</DialogTitle>
                <DialogDescription>
                  Connect a native calendar app like iOS Calendar or macOS Calendar.app
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <label className="text-on-surface mb-2 block text-sm font-medium">
                    Device name
                  </label>
                  <Input
                    value={deviceName}
                    onChange={(e) => {
                      setDeviceName(e.target.value);
                    }}
                    placeholder="e.g., iPhone Calendar"
                    autoFocus
                  />
                </div>

                <div>
                  <p className="text-on-surface-variant mb-2 text-sm">Quick select:</p>
                  <div className="flex flex-wrap gap-2">
                    {DEVICE_PRESET_NAMES.map((name) => (
                      <Button
                        key={name}
                        variant="outlined"
                        size="sm"
                        onClick={() => {
                          setDeviceName(name);
                        }}
                      >
                        {name}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="text" onClick={handleClose}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={!deviceName.trim() || isPending}>
                  {isPending ? 'Creating...' : 'Create password'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Set up {deviceName}</DialogTitle>
                <DialogDescription>
                  Use these credentials in your calendar app. The password won't be shown again.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="bg-surface-container-high rounded-lg p-4">
                  <div className="space-y-3">
                    <div>
                      <label className="text-on-surface-variant text-xs font-medium tracking-wide uppercase">
                        Server
                      </label>
                      <div className="mt-1 flex items-center gap-2">
                        <code className="text-on-surface font-mono text-sm">{serverUrl}</code>
                        <Button
                          variant="text"
                          size="icon"
                          onClick={() => {
                            handleCopy(serverUrl);
                          }}
                          className="h-7 w-7"
                        >
                          <ContentCopyOutlinedIcon sx={{ fontSize: 16 }} />
                        </Button>
                      </div>
                    </div>

                    <div>
                      <label className="text-on-surface-variant text-xs font-medium tracking-wide uppercase">
                        Password
                      </label>
                      <div className="mt-1 flex items-center gap-2">
                        <code className="text-on-surface bg-surface-container rounded px-2 py-1 font-mono text-sm">
                          {generatedPassword}
                        </code>
                        <Button
                          variant="text"
                          size="icon"
                          onClick={() => {
                            handleCopy(generatedPassword ?? '');
                          }}
                          className="h-7 w-7"
                        >
                          {copied ? (
                            <CheckOutlinedIcon sx={{ fontSize: 16 }} className="text-primary" />
                          ) : (
                            <ContentCopyOutlinedIcon sx={{ fontSize: 16 }} />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-tertiary-container/30 rounded-lg p-4">
                  <h4 className="text-on-tertiary-container mb-2 text-sm font-medium">
                    Setup instructions
                  </h4>
                  <ol className="text-on-surface-variant list-inside list-decimal space-y-1 text-sm">
                    <li>
                      Open Settings → Calendar → Accounts (iOS) or System Settings → Internet
                      Accounts (Mac)
                    </li>
                    <li>Add a CalDAV account</li>
                    <li>Enter the server and password above</li>
                    <li>Use your account email as the username</li>
                  </ol>
                </div>

                <div className="bg-error-container/30 rounded-lg p-3">
                  <p className="text-error text-sm font-medium">
                    Save this password now - you won't see it again.
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button onClick={handleClose}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
