'use client';

/**
 * `settings` — turnkey passkey enrollment and post-creation management for the Security tab.
 *
 * @remarks
 * A person starts the platform passkey ceremony with one click. Better Auth assigns the initial
 * label after verification, while this surface classifies the stored WebAuthn facts into a synced,
 * device, security-key, or nearby-device treatment. Rename and remove stay available from each
 * row's overflow menu without turning every resting name into a form field.
 */
import {
  passkeyAuthenticatorKind,
  passkeyAuthenticatorKindLabel,
  type PasskeyAuthenticatorKind,
} from '@docket/types';
import { cn } from '@docket/ui';
import { EmptyState } from '@docket/ui/components';
import {
  CloudSync,
  Edit,
  Ellipsis,
  Fingerprint,
  Key,
  PhonePasskey,
  Plus,
  Shield,
  Trash2,
  Usb,
  type LucideIcon,
} from '@docket/ui/icons';
import {
  Button,
  DecorativeIcon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Skeleton,
} from '@docket/ui/primitives';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type JSX, useId, useState } from 'react';

import { ROW_BASE, ROW_INTERACTIVE } from '@/components/settings/setting-row';
import { passkey } from '@/lib/auth-client';
import { formatCalendarDate } from '@/lib/format-date';
import { toUserFacingError, userErrorMessage } from '@/lib/problem';
import { LoadFailure } from './load-failure';
import { SETTINGS_NODES } from './settings-capabilities';
import { SettingsGroup } from './settings-group';
import { WriteError } from './write-error';

/** The Better Auth passkey record fields this UI renders. */
interface PasskeyRecord {
  readonly id: string;
  readonly name?: string | undefined;
  readonly deviceType: string;
  readonly backedUp?: boolean | undefined;
  readonly transports?: string | undefined;
  readonly aaguid?: string | undefined;
  readonly createdAt: string | Date;
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

/** Return the stored label or a neutral fallback for an old unnamed passkey. */
function passkeyLabel(record: PasskeyRecord): string {
  const name = record.name?.trim();
  return name && name.length > 0 ? name : 'Passkey';
}

/** Render a passkey's creation date while tolerating a string or Date wire value. */
function addedOn(record: PasskeyRecord): string | null {
  const formatted = formatCalendarDate(new Date(record.createdAt).toISOString());
  return formatted ? `Added ${formatted}` : null;
}

/** The icon, label, and MD3 tone assigned to one inferred authenticator kind. */
interface AuthenticatorPresentation {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly tone: string;
}

/** Map stored WebAuthn facts to an authenticator-kind presentation. */
function authenticatorPresentation(record: PasskeyRecord): AuthenticatorPresentation {
  const kind = passkeyAuthenticatorKind(record);
  const label = passkeyAuthenticatorKindLabel(kind);
  const presentations: Record<PasskeyAuthenticatorKind, AuthenticatorPresentation> = {
    synced: {
      icon: CloudSync,
      label,
      tone: 'bg-primary-container text-on-primary-container',
    },
    device: {
      icon: Fingerprint,
      label,
      tone: 'bg-tertiary-container text-on-tertiary-container',
    },
    'security-key': {
      icon: Usb,
      label,
      tone: 'bg-secondary-container text-on-secondary-container',
    },
    'nearby-device': {
      icon: PhonePasskey,
      label,
      tone: 'bg-secondary-container text-on-secondary-container',
    },
    unknown: {
      icon: Key,
      label,
      tone: 'bg-surface-container-high text-on-surface-variant',
    },
  };
  return presentations[kind];
}

/** The Security-tab card that lists and manages the user's passkeys. */
export function PasskeysSection(): JSX.Element {
  const queryClient = useQueryClient();
  const listQ = useQuery({ queryKey: PASSKEYS_QUERY_KEY, queryFn: fetchPasskeys });
  const [removing, setRemoving] = useState<PasskeyRecord | null>(null);
  const [renaming, setRenaming] = useState<PasskeyRecord | null>(null);
  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY });
  const add = useMutation({
    mutationFn: async () => {
      const result = await passkey.addPasskey();
      if (result.error) {
        throw toUserFacingError(result.error, 'Could not add the passkey.');
      }
    },
    onSuccess: () => {
      void invalidate();
    },
  });

  if (listQ.isPending) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }
  if (listQ.isError) {
    return (
      <LoadFailure
        message={userErrorMessage(listQ.error, 'Could not load your passkeys.')}
        retrying
      />
    );
  }

  const passkeys = listQ.data;
  const addLabel = add.isPending ? 'Waiting for your device…' : 'Add passkey';
  const startEnrollment = (): void => {
    if (!add.isPending) add.mutate();
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Passkeys">
      <SettingsGroup
        capability={SETTINGS_NODES.securityPasskeys}
        body="rows"
        action={
          passkeys.length > 0 ? (
            <Button
              type="button"
              variant="secondary"
              disabled={add.isPending}
              onClick={startEnrollment}
            >
              <Plus aria-hidden="true" />
              {addLabel}
            </Button>
          ) : undefined
        }
      >
        {passkeys.length === 0 ? (
          <EmptyState
            icon={Shield}
            title="No passkeys yet"
            body="A passkey is how you sign in — your fingerprint, face, or a security key. Add one for each device you use."
            frame="none"
            cta={{ label: addLabel, onClick: startEnrollment }}
          />
        ) : (
          <ul>
            {passkeys.map((record) => (
              <PasskeyRow
                key={record.id}
                record={record}
                onRename={() => {
                  setRenaming(record);
                }}
                onRemove={() => {
                  setRemoving(record);
                }}
              />
            ))}
          </ul>
        )}
      </SettingsGroup>

      {add.isError ? (
        <WriteError message={userErrorMessage(add.error, 'Could not add the passkey.')} />
      ) : null}

      {renaming ? (
        <RenamePasskeyDialog
          key={renaming.id}
          record={renaming}
          onOpenChange={(open) => {
            if (!open) setRenaming(null);
          }}
          onRenamed={() => {
            setRenaming(null);
            void invalidate();
          }}
        />
      ) : null}

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

/** Props for the optional post-creation passkey rename dialog. */
interface RenamePasskeyDialogProps {
  readonly record: PasskeyRecord;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRenamed: () => void;
}

/** Rename a passkey after registration without putting an input in every resting row. */
function RenamePasskeyDialog({
  record,
  onOpenChange,
  onRenamed,
}: RenamePasskeyDialogProps): JSX.Element {
  const nameId = useId();
  const persistedName = passkeyLabel(record);
  const [name, setName] = useState(persistedName);
  const rename = useMutation({
    mutationFn: async (nextName: string) => {
      const result = await passkey.updatePasskey({ id: record.id, name: nextName });
      if (result.error) {
        throw toUserFacingError(result.error, 'Could not rename the passkey.');
      }
    },
    onSuccess: onRenamed,
  });
  const trimmedName = name.trim();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) rename.reset();
        onOpenChange(open);
      }}
    >
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmedName && trimmedName !== persistedName) rename.mutate(trimmedName);
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename passkey</DialogTitle>
            <DialogDescription>
              Choose a name that helps you recognize this passkey later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label htmlFor={nameId} className="text-on-surface text-label-large">
              Passkey name
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
            <WriteError message={userErrorMessage(rename.error, 'Could not rename the passkey.')} />
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
              type="submit"
              disabled={
                rename.isPending || trimmedName.length === 0 || trimmedName === persistedName
              }
            >
              {rename.isPending ? 'Saving…' : 'Save name'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Props for one passkey row. */
interface PasskeyRowProps {
  readonly record: PasskeyRecord;
  readonly onRename: () => void;
  readonly onRemove: () => void;
}

/** Render one readable passkey row with kind-specific presentation and overflow actions. */
function PasskeyRow({ record, onRename, onRemove }: PasskeyRowProps): JSX.Element {
  const presentation = authenticatorPresentation(record);
  const label = passkeyLabel(record);

  return (
    <li className={cn(ROW_BASE, ROW_INTERACTIVE)}>
      <DecorativeIcon icon={presentation.icon} className={cn('shrink-0', presentation.tone)} />
      <div className="min-w-0 flex-1">
        <p className="text-on-surface text-label-large truncate">{label}</p>
        <p className="text-on-surface-variant text-body-small truncate">
          {[presentation.label, addedOn(record)].filter(Boolean).join(' · ')}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" iconOnly aria-label={`Actions for ${label}`}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRename}>
            <Edit />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={onRemove}>
            <Trash2 />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** Props for the passkey removal confirmation. */
interface RemovePasskeyDialogProps {
  readonly record: PasskeyRecord | null;
  readonly isLast: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRemoved: () => void;
}

/** Confirm passkey removal and warn when the selected credential is the account's last passkey. */
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
      onOpenChange={(open) => {
        if (!open) remove.reset();
        onOpenChange(open);
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
          <WriteError message={userErrorMessage(remove.error, 'Could not remove the passkey.')} />
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
