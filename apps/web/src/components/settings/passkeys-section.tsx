'use client';

/**
 * `settings` — passkey management (list / add / rename / remove) for the Security tab.
 *
 * @remarks
 * Docket is passwordless: a passkey is the primary credential, so this is where a signed-in user
 * curates the passkeys bound to their account. It lists every registered passkey (via the Better
 * Auth `passkey.listUserPasskeys()` client method), lets them **add** a passkey to the current
 * device/authenticator from an already-authenticated session (`passkey.addPasskey`) — the correct,
 * session-bound home for enrollment that replaces the removed unauthenticated registration path —
 * **rename** one (`passkey.updatePasskey`), and **remove** one (`passkey.deletePasskey`).
 *
 * Removing the *last* passkey would leave the account reachable only through recovery codes (or a
 * linked social provider), so that case gets an explicit, louder confirmation rather than the same
 * quiet prompt. Reads/writes go straight to the Better Auth client (passkeys are not a Hono REST
 * resource); the list is held in a TanStack query so mutations can invalidate and refetch it.
 * Errors render inline as `role="alert"` banners — there is no toast system.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Shield, Trash2 } from '@docket/ui/icons';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
} from '@docket/ui/primitives';
import { type JSX, useId, useState } from 'react';

import { passkey } from '@/lib/auth-client';
import { formatCalendarDate } from '@/lib/format-date';
import { toUserFacingError, userErrorMessage } from '@/lib/problem';

/** The Better Auth passkey record as returned by `listUserPasskeys` (subset this UI renders). */
interface PasskeyRecord {
  id: string;
  name?: string | undefined;
  deviceType: string;
  createdAt: string | Date;
}

/** The TanStack cache key for the signed-in user's passkey list. */
const PASSKEYS_QUERY_KEY = ['passkeys'] as const;

/** Fetch the current user's passkeys, retaining only application-owned failure copy. */
async function fetchPasskeys(): Promise<PasskeyRecord[]> {
  const result = await passkey.listUserPasskeys();
  if (result.error) {
    throw toUserFacingError(result.error, 'Could not load your passkeys.');
  }
  return result.data;
}

/** A friendly label for a passkey whose name the user never set. */
function passkeyLabel(record: PasskeyRecord): string {
  const name = record.name?.trim();
  return name && name.length > 0 ? name : 'Unnamed passkey';
}

/** Render a passkey's "Added <date>" line, tolerating the wire value being a string or Date. */
function addedOn(record: PasskeyRecord): string | null {
  const iso = new Date(record.createdAt).toISOString();
  const formatted = formatCalendarDate(iso);
  return formatted ? `Added ${formatted}` : null;
}

/** The Security-tab card that lists and manages the user's passkeys. */
export function PasskeysSection(): JSX.Element {
  const queryClient = useQueryClient();
  const listQ = useQuery({ queryKey: PASSKEYS_QUERY_KEY, queryFn: fetchPasskeys });

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PasskeyRecord | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY });

  if (listQ.isPending) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }
  if (listQ.isError) {
    return (
      <p role="alert" className="text-destructive text-body-medium">
        {userErrorMessage(listQ.error, 'Could not update your passkeys.')}
      </p>
    );
  }

  const passkeys = listQ.data;

  return (
    <section className="flex flex-col gap-3" aria-label="Passkeys">
      <div className="bg-surface-container-low flex flex-col gap-3 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-on-surface text-body-medium font-medium">Passkeys</h3>
            <p className="text-on-surface-variant text-body-medium max-w-prose">
              Passkeys are how you sign in — Face ID, Touch ID, or a security key, with no password.
              Add one for each device you use so you&apos;re never locked out if you lose another.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            onClick={() => {
              setAddOpen(true);
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            Add passkey
          </Button>
        </div>

        {passkeys.length === 0 ? (
          <p className="text-on-surface-variant text-body-medium">
            No passkeys yet. Add one to sign in from this device.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {passkeys.map((record) => (
              <li
                key={record.id}
                className="border-outline-variant bg-surface flex items-center gap-3 rounded-lg border p-3"
              >
                <Shield aria-hidden="true" className="text-on-surface-variant size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-on-surface text-body-medium truncate font-medium">
                    {passkeyLabel(record)}
                  </p>
                  <p className="text-on-surface-variant truncate text-xs">
                    {[addedOn(record), record.deviceType === 'multiDevice' ? 'Synced' : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRenamingId(record.id);
                  }}
                >
                  Rename
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${passkeyLabel(record)}`}
                  onClick={() => {
                    setRemoving(record);
                  }}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AddPasskeyDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={() => {
          void invalidate();
        }}
      />

      <RenamePasskeyDialog
        record={passkeys.find((record) => record.id === renamingId) ?? null}
        onOpenChange={(open) => {
          if (!open) setRenamingId(null);
        }}
        onRenamed={() => {
          void invalidate();
        }}
      />

      <RemovePasskeyDialog
        record={removing}
        isLast={passkeys.length === 1}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        onRemoved={() => {
          void invalidate();
        }}
      />
    </section>
  );
}

/** Props for {@link AddPasskeyDialog}. */
interface AddPasskeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

/** Name-and-register dialog: runs the WebAuthn add ceremony from the authenticated session. */
function AddPasskeyDialog({ open, onOpenChange, onAdded }: AddPasskeyDialogProps): JSX.Element {
  const nameId = useId();
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: async (passkeyName: string) => {
      const trimmed = passkeyName.trim();
      const result = await passkey.addPasskey(trimmed.length > 0 ? { name: trimmed } : undefined);
      if (result.error) {
        throw toUserFacingError(result.error, 'Could not add the passkey.');
      }
    },
    onSuccess: () => {
      onAdded();
      setName('');
      onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          add.reset();
          setName('');
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a passkey</DialogTitle>
          <DialogDescription>
            Your device will prompt you to confirm with Face ID, Touch ID, or a security key. Give
            this passkey a name so you can recognize it later.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <label htmlFor={nameId} className="text-on-surface text-body-medium font-medium">
            Name
          </label>
          <Input
            id={nameId}
            value={name}
            placeholder="e.g. MacBook Pro"
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
        {add.isError ? (
          <p role="alert" className="text-destructive text-body-medium">
            {userErrorMessage(add.error, 'Could not update your passkeys.')}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={add.isPending}
            onClick={() => {
              add.mutate(name);
            }}
          >
            {add.isPending ? 'Waiting for your device…' : 'Add passkey'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Props for {@link RenamePasskeyDialog}. */
interface RenamePasskeyDialogProps {
  record: PasskeyRecord | null;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void;
}

/** Rename dialog shell: opens when `record` is non-null and remounts the form per passkey. */
function RenamePasskeyDialog({
  record,
  onOpenChange,
  onRenamed,
}: RenamePasskeyDialogProps): JSX.Element {
  return (
    <Dialog open={record !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {record ? (
          // Key on the passkey id so the input re-seeds with the right current name each time.
          <RenamePasskeyForm
            key={record.id}
            record={record}
            onCancel={() => {
              onOpenChange(false);
            }}
            onRenamed={() => {
              onRenamed();
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** The rename form, seeded with the passkey's current name (remounted per passkey by its key). */
function RenamePasskeyForm({
  record,
  onCancel,
  onRenamed,
}: {
  record: PasskeyRecord;
  onCancel: () => void;
  onRenamed: () => void;
}): JSX.Element {
  const nameId = useId();
  const [name, setName] = useState(() => record.name?.trim() ?? '');
  const rename = useMutation({
    mutationFn: async (nextName: string) => {
      const result = await passkey.updatePasskey({ id: record.id, name: nextName.trim() });
      if (result.error) {
        throw toUserFacingError(result.error, 'Could not rename the passkey.');
      }
    },
    onSuccess: onRenamed,
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename passkey</DialogTitle>
        <DialogDescription>Give this passkey a name you&apos;ll recognize.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <label htmlFor={nameId} className="text-on-surface text-body-medium font-medium">
          Name
        </label>
        <Input
          id={nameId}
          value={name}
          autoComplete="off"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>
      {rename.isError ? (
        <p role="alert" className="text-destructive text-body-medium">
          {userErrorMessage(rename.error, 'Could not update your passkeys.')}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={rename.isPending || name.trim().length === 0}
          onClick={() => {
            rename.mutate(name);
          }}
        >
          {rename.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Props for {@link RemovePasskeyDialog}. */
interface RemovePasskeyDialogProps {
  record: PasskeyRecord | null;
  isLast: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}

/** Confirm-and-remove dialog; warns harder when it is the account's only passkey. */
function RemovePasskeyDialog({
  record,
  isLast,
  onOpenChange,
  onRemoved,
}: RemovePasskeyDialogProps): JSX.Element {
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const result = await passkey.deletePasskey({ id });
      if (result.error) {
        throw toUserFacingError(result.error, 'Could not remove the passkey.');
      }
    },
    onSuccess: () => {
      onRemoved();
      onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={record !== null}
      onOpenChange={(next) => {
        if (!next) remove.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove passkey?</DialogTitle>
          <DialogDescription>
            {isLast
              ? 'This is your only passkey. Remove it and you can only get back in with a recovery code or a linked sign-in provider — add another passkey first if you can.'
              : 'This passkey will no longer be able to sign in to your account. You can add it again later.'}
          </DialogDescription>
        </DialogHeader>
        {remove.isError ? (
          <p role="alert" className="text-destructive text-body-medium">
            {userErrorMessage(remove.error, 'Could not update your passkeys.')}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              if (record) remove.mutate(record.id);
            }}
          >
            {remove.isPending ? 'Removing…' : 'Remove passkey'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
