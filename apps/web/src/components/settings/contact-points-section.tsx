'use client';

/**
 * `settings` — caller-owned notification contact points.
 *
 * @remarks
 * Lists every email/phone/push destination the notification service can target and exposes the
 * small lifecycle actions the API supports: add phone, verify pending destinations, make active
 * destinations primary, and disable destinations without deleting delivery history.
 */
import type { ContactPointCreate, ContactPointOut } from '@docket/notifications';
import { WriteError } from './write-error';
import { cn } from '@docket/ui';
import { EmptyState } from '@docket/ui/components';
import { SettingsGroup } from './settings-group';
import { CheckCircle2, Mail, MessageSquare, Trash2, X } from '@docket/ui/icons';
import { Badge, Button, DecorativeIcon, Input } from '@docket/ui/primitives';
import { type JSX, type SyntheticEvent, useState } from 'react';

/** Props for {@link ContactPointsSection}. */
export interface ContactPointsSectionProps {
  /** Contact points returned by `GET /v1/me/contact-points`. */
  readonly contactPoints: readonly ContactPointOut[];
  /** Whether a create mutation is in flight. */
  readonly creating: boolean;
  /** Contact-point id currently being mutated. */
  readonly savingId: string | null;
  /** Contact-point id currently being verified. */
  readonly verifyingId: string | null;
  /** Inline mutation/read error. */
  readonly error: string | null;
  /** Create a new contact point. */
  readonly onAdd: (input: ContactPointCreate) => Promise<void> | void;
  /** Verify a pending contact point. */
  readonly onVerify: (id: string, code: string) => Promise<void> | void;
  /** Make one active contact point primary within its type. */
  readonly onMakePrimary: (id: string) => Promise<void> | void;
  /** Disable one contact point. */
  readonly onDisable: (id: string) => Promise<void> | void;
}

type AddableContactPointType = 'email' | 'phone';

/** Notification destination list and destination-add form. */
export function ContactPointsSection({
  contactPoints,
  creating,
  savingId,
  verifyingId,
  error,
  onAdd,
  onVerify,
  onMakePrimary,
  onDisable,
}: ContactPointsSectionProps): JSX.Element {
  // Split by type, and drop `push_token` entirely. The server scopes `primary` *within its
  // destination type* — there is one primary email and one primary phone — so a single flat list
  // showed two "Primary" badges with nothing saying what each was primary for. Push tokens are
  // registered by a device, never typed in here, and used to render as rows nothing could act on.
  const emails = contactPoints.filter((point) => point.type === 'email');
  const phones = contactPoints.filter((point) => point.type === 'phone');

  return (
    <>
      <ContactPointGroup
        kind="email"
        points={emails}
        creating={creating}
        savingId={savingId}
        verifyingId={verifyingId}
        onAdd={onAdd}
        onVerify={onVerify}
        onMakePrimary={onMakePrimary}
        onDisable={onDisable}
      />
      <ContactPointGroup
        kind="phone"
        points={phones}
        creating={creating}
        savingId={savingId}
        verifyingId={verifyingId}
        onAdd={onAdd}
        onVerify={onVerify}
        onMakePrimary={onMakePrimary}
        onDisable={onDisable}
      />

      {error ? <WriteError message={error} /> : null}
    </>
  );
}

/** Copy and input semantics for each destination kind. */
const KIND = {
  email: {
    title: 'Email addresses',
    description: 'Where Docket sends email notifications.',
    field: 'Email address',
    inputType: 'email',
    autoComplete: 'email',
    purpose: 'email_notifications',
    empty: 'Add an email address so Docket can send email notifications.',
    icon: Mail,
    /** What the reader loses while none of these exist, in the words the group already uses. */
    channel: 'email',
  },
  phone: {
    title: 'Phone numbers',
    description: 'Where Docket sends text messages.',
    field: 'Phone number',
    inputType: 'tel',
    autoComplete: 'tel',
    purpose: 'sms_notifications',
    empty: 'Add a phone number so Docket can send text messages.',
    icon: MessageSquare,
    channel: 'text message',
  },
} as const;

/** Props for {@link ContactPointGroup}. */
interface ContactPointGroupProps {
  readonly kind: AddableContactPointType;
  readonly points: readonly ContactPointOut[];
  readonly creating: boolean;
  readonly savingId: string | null;
  readonly verifyingId: string | null;
  readonly onAdd: (input: ContactPointCreate) => Promise<void> | void;
  readonly onVerify: (id: string, code: string) => Promise<void> | void;
  readonly onMakePrimary: (id: string) => Promise<void> | void;
  readonly onDisable: (id: string) => Promise<void> | void;
}

/**
 * One destination kind: its own list, its own primary, and its own add field.
 *
 * @remarks
 * Email and phone were one list behind a "Contact method" select, which made you choose a mode
 * before you could type and flattened a per-type concept into a single column. Splitting them
 * removes the select entirely — the group you are in *is* the type — and lets each side carry the
 * one primary the server actually scopes to it.
 */
function ContactPointGroup({
  kind,
  points,
  creating,
  savingId,
  verifyingId,
  onAdd,
  onVerify,
  onMakePrimary,
  onDisable,
}: ContactPointGroupProps): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const [confirmDisableId, setConfirmDisableId] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const copy = KIND[kind];

  const submit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    void Promise.resolve(onAdd({ type: kind, value: trimmed, purpose: copy.purpose })).then(() => {
      setValue('');
      setAdding(false);
    });
  };

  return (
    <SettingsGroup
      title={copy.title}
      discoverable={false}
      description={copy.description}
      body="rows"
      action={
        points.length > 0 || adding ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={adding}
            onClick={() => {
              setAdding((open) => !open);
            }}
          >
            {adding ? 'Cancel' : 'Add'}
          </Button>
        ) : undefined
      }
    >
      {adding ? (
        <form
          onSubmit={submit}
          className="grid gap-2 px-4 pb-3 @2xl:grid-cols-[1fr_auto] @2xl:items-end"
        >
          <label className="text-on-surface-variant text-body-small flex min-w-0 flex-col gap-1">
            {copy.field}
            <Input
              type={copy.inputType}
              value={value}
              disabled={creating}
              autoComplete={copy.autoComplete}
              onChange={(event) => {
                setValue(event.target.value);
              }}
            />
          </label>
          <Button type="submit" variant="outline" disabled={creating || value.trim().length === 0}>
            {creating ? 'Adding…' : 'Add'}
          </Button>
        </form>
      ) : null}

      <div className="flex flex-col">
        {points.length === 0 && !adding ? (
          <EmptyState
            icon={copy.icon}
            title={`No ${copy.title.toLowerCase()} yet`}
            body={copy.empty}
            frame="none"
            cta={{
              label: `Add ${copy.field.toLowerCase()}`,
              onClick: () => {
                setAdding(true);
              },
            }}
          />
        ) : null}
        {points.map((point) => (
          <div key={point.id} className="even:bg-surface-container flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <DecorativeIcon className="bg-surface-container mt-0.5 shrink-0">
                  {point.type === 'email' ? <Mail /> : <MessageSquare />}
                </DecorativeIcon>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-on-surface text-label-large truncate">{point.value}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <ContactPointStatusBadge point={point} />
                    {point.primary ? <Badge variant="outline">Primary</Badge> : null}
                  </div>
                  {STATUS_NOTE[point.status] === undefined ? null : (
                    <p className="text-on-surface-variant text-body-small">
                      {STATUS_NOTE[point.status]}{' '}
                      {point.status === 'disabled'
                        ? `Add it again above to resume ${copy.channel} notifications.`
                        : `Remove it and add it again to resume ${copy.channel} notifications.`}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {point.status === 'active' && !point.primary ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={savingId === point.id}
                    onClick={() => {
                      void onMakePrimary(point.id);
                    }}
                  >
                    <CheckCircle2 className="size-4" />
                    Make primary
                  </Button>
                ) : null}
                {point.status !== 'disabled' ? (
                  confirmDisableId === point.id ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`Confirm disable ${point.value}`}
                        disabled={savingId === point.id}
                        onClick={() => {
                          void Promise.resolve(onDisable(point.id)).then(() => {
                            setConfirmDisableId(null);
                          });
                        }}
                      >
                        <Trash2 className="size-4" />
                        Confirm
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Cancel disable ${point.value}`}
                        disabled={savingId === point.id}
                        onClick={() => {
                          setConfirmDisableId(null);
                        }}
                      >
                        <X className="size-4" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Disable ${point.value}`}
                      title={`Disable ${point.value}`}
                      disabled={savingId === point.id}
                      onClick={() => {
                        setConfirmDisableId(point.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )
                ) : null}
              </div>
            </div>

            {point.status === 'pending' ? (
              <div className="flex flex-col gap-2 @2xl:flex-row @2xl:items-end">
                <label className="text-on-surface-variant text-body-small flex min-w-0 flex-1 flex-col gap-1">
                  Verification code
                  <Input
                    value={codes[point.id] ?? ''}
                    inputMode="numeric"
                    aria-label={`Verification code for ${point.value}`}
                    disabled={verifyingId === point.id}
                    onChange={(event) => {
                      setCodes((current) => ({ ...current, [point.id]: event.target.value }));
                    }}
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  disabled={verifyingId === point.id || !(codes[point.id] ?? '').trim()}
                  onClick={() => {
                    void onVerify(point.id, (codes[point.id] ?? '').trim());
                  }}
                >
                  Verify {point.value}
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </SettingsGroup>
  );
}

/**
 * What each non-working state means and what ends it.
 *
 * @remarks
 * "Bounced" and "Unsubscribed" were rendered as badges and nothing else — a dead end that names a
 * condition, offers no cause, and leaves the reader believing notifications work when they do not.
 * Both are recoverable, and both recover the same way, so the row says so.
 */
const STATUS_NOTE: Partial<Record<ContactPointOut['status'], string>> = {
  bounced: 'Delivery to this address keeps failing, so Docket stopped sending to it.',
  unsubscribed: 'You unsubscribed, so Docket stopped sending to it.',
  disabled: 'Docket does not send here.',
};

/** Props for {@link ContactPointStatusBadge}. */
interface ContactPointStatusBadgeProps {
  readonly point: ContactPointOut;
}

/** Status badge for one contact point lifecycle state. */
function ContactPointStatusBadge({ point }: ContactPointStatusBadgeProps): JSX.Element {
  const label =
    point.status === 'pending'
      ? 'Verification pending'
      : point.status === 'active'
        ? 'Active'
        : point.status === 'disabled'
          ? 'Disabled'
          : point.status === 'bounced'
            ? 'Bounced'
            : 'Unsubscribed';
  return (
    <Badge
      variant={point.status === 'active' ? 'secondary' : 'outline'}
      className={cn(point.status !== 'active' && 'text-on-surface-variant')}
    >
      {label}
    </Badge>
  );
}
