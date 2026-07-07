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
import { cn } from '@docket/ui';
import { CheckCircle2, Mail, MessageSquare, Trash2, X } from '@docket/ui/icons';
import { Badge, Button, Input } from '@docket/ui/primitives';
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

const CONTACT_METHODS: readonly { type: AddableContactPointType; label: string }[] = [
  { type: 'phone', label: 'Phone' },
  { type: 'email', label: 'Email' },
];

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
  const [contactType, setContactType] = useState<AddableContactPointType>('phone');
  const [destination, setDestination] = useState('');
  const [confirmDisableId, setConfirmDisableId] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});

  const submitDestination = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = destination.trim();
    if (!value) return;
    const purpose = contactType === 'email' ? 'email_notifications' : 'sms_notifications';
    void Promise.resolve(onAdd({ type: contactType, value, purpose })).then(() => {
      setDestination('');
    });
  };

  const destinationLabel = contactType === 'phone' ? 'Phone number' : 'Destination';
  const destinationType = contactType === 'phone' ? 'tel' : 'email';
  const autocomplete = contactType === 'phone' ? 'tel' : 'email';

  return (
    <section aria-label="Notification contact points" className="flex flex-col gap-4">
      <form
        onSubmit={submitDestination}
        className="grid gap-2 @2xl:grid-cols-[10rem_minmax(0,1fr)_auto] @2xl:items-end"
      >
        <label className="text-on-surface-variant flex min-w-0 flex-col gap-1 text-xs">
          Contact method
          <select
            value={contactType}
            disabled={creating}
            className="border-outline-variant text-body focus-visible:ring-ring h-9 rounded-md border bg-transparent px-3 shadow-sm focus-visible:ring-2 focus-visible:outline-none"
            onChange={(event) => {
              setContactType(event.target.value as AddableContactPointType);
              setDestination('');
            }}
          >
            {CONTACT_METHODS.map((method) => (
              <option key={method.type} value={method.type}>
                {method.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-on-surface-variant flex min-w-0 flex-1 flex-col gap-1 text-xs">
          {destinationLabel}
          <Input
            type={destinationType}
            value={destination}
            disabled={creating}
            autoComplete={autocomplete}
            onChange={(event) => {
              setDestination(event.target.value);
            }}
          />
        </label>
        <Button
          type="submit"
          variant="outline"
          disabled={creating || destination.trim().length === 0}
        >
          {contactType === 'email' ? (
            <Mail className="size-4" />
          ) : (
            <MessageSquare className="size-4" />
          )}
          {creating ? 'Adding…' : contactType === 'email' ? 'Add destination' : 'Add phone'}
        </Button>
      </form>

      <div className="border-outline-variant divide-outline-variant rounded-lg border">
        {contactPoints.map((point) => (
          <div key={point.id} className="border-outline-variant flex flex-col gap-3 border-b p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="bg-surface-container text-on-surface-variant mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
                  {point.type === 'email' ? (
                    <Mail aria-hidden="true" className="size-4" />
                  ) : (
                    <MessageSquare aria-hidden="true" className="size-4" />
                  )}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-on-surface text-body truncate font-medium">
                    {point.valueMasked}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <ContactPointStatusBadge point={point} />
                    {point.primary ? (
                      <Badge variant="outline" className="font-normal">
                        Primary
                      </Badge>
                    ) : null}
                  </div>
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
                        aria-label={`Confirm disable ${point.valueMasked}`}
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
                        aria-label={`Cancel disable ${point.valueMasked}`}
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
                      aria-label={`Disable ${point.valueMasked}`}
                      title={`Disable ${point.valueMasked}`}
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
                <label className="text-on-surface-variant flex min-w-0 flex-1 flex-col gap-1 text-xs">
                  Verification code
                  <Input
                    value={codes[point.id] ?? ''}
                    inputMode="numeric"
                    aria-label={`Verification code for ${point.valueMasked}`}
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
                  Verify {point.valueMasked}
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-body">
          {error}
        </p>
      ) : null}
    </section>
  );
}

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
      className={cn('font-normal', point.status !== 'active' && 'text-on-surface-variant')}
    >
      {label}
    </Badge>
  );
}
