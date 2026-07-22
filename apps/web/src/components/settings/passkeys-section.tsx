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
 * **rename** one in place (`passkey.updatePasskey`, autosaved via {@link EditableTitle} — no Save
 * button), and **remove** one (`passkey.deletePasskey`).
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
  DecorativeIcon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
} from '@docket/ui/primitives';
import { type JSX, useEffect, useId, useState } from 'react';

import { EditableTitle } from '@/components/editor/editable-title';
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
              <PasskeyRow
                key={record.id}
                record={record}
                onRenamed={() => {
                  void invalidate();
                }}
                onRemove={() => {
                  setRemoving(record);
                }}
              />
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

/** Props for {@link PasskeyRow}. */
interface PasskeyRowProps {
  record: PasskeyRecord;
  /** Invoked after a rename persists so the list can refetch. */
  onRenamed: () => void;
  /** Open the remove-confirmation dialog for this passkey. */
  onRemove: () => void;
}

/** How long the quiet "Saved" acknowledgement lingers after an inline rename lands. */
const SAVED_HINT_MS = 2000;

/**
 * A single passkey row whose name renames in place: no Rename button, no dialog.
 *
 * @remarks
 * The name is an {@link EditableTitle}, always an editable field that autosaves on a debounce (or
 * immediately on Enter). That primitive owns the dirty guard — it only calls `onSave` when the
 * trimmed value is non-empty *and* changed from what's persisted, so a rename never fires on mount
 * or on an emptied field (which reverts). The save runs the same `passkey.updatePasskey` mutation
 * the old dialog's Save button used, now triggered by the autosave. A quiet inline word next to the
 * name reports the mutation state — a brief "Saved", or an inline error that keeps the field editable.
 */
function PasskeyRow({ record, onRenamed, onRemove }: PasskeyRowProps): JSX.Element {
  const [showSaved, setShowSaved] = useState(false);
  const rename = useMutation({
    mutationFn: async (nextName: string) => {
      const result = await passkey.updatePasskey({ id: record.id, name: nextName.trim() });
      if (result.error) {
        throw toUserFacingError(result.error, 'Could not rename the passkey.');
      }
    },
    onSuccess: onRenamed,
  });

  // Show the "Saved" acknowledgement briefly after each successful commit, then fade it out.
  useEffect(() => {
    if (!rename.isSuccess) return;
    setShowSaved(true);
    const timer = setTimeout(() => {
      setShowSaved(false);
    }, SAVED_HINT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [rename.isSuccess, rename.submittedAt]);

  return (
    <li className="border-outline-variant bg-surface flex items-center gap-3 rounded-lg border p-3">
      <DecorativeIcon icon={Shield} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <EditableTitle
            value={record.name?.trim() ?? ''}
            onSave={(next) => {
              rename.mutate(next);
            }}
            canEdit
            ariaLabel="Passkey name"
            placeholder="Unnamed passkey"
            className="text-on-surface text-body-medium min-w-0 truncate font-medium"
          />
          {rename.isError ? (
            <span role="alert" className="text-destructive shrink-0 text-xs">
              {userErrorMessage(rename.error, 'Could not update your passkeys.')}
            </span>
          ) : showSaved ? (
            <span className="text-on-surface-variant shrink-0 text-xs">Saved</span>
          ) : null}
        </div>
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
        aria-label={`Remove ${passkeyLabel(record)}`}
        onClick={onRemove}
      >
        <Trash2 aria-hidden="true" className="size-4" />
      </Button>
    </li>
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
