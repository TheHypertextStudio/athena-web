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
import { CheckCircle2, Mail, MessageSquare, Trash2 } from '@docket/ui/icons';
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

/** Notification destination list and phone-add form. */
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
  const [phone, setPhone] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>({});

  const submitPhone = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = phone.trim();
    if (!value) return;
    void Promise.resolve(onAdd({ type: 'phone', value, purpose: 'sms_notifications' })).then(() => {
      setPhone('');
    });
  };

  return (
    <section aria-label="Notification contact points" className="flex flex-col gap-4">
      <form onSubmit={submitPhone} className="flex flex-col gap-2 @2xl:flex-row @2xl:items-end">
        <label className="text-on-surface-variant flex min-w-0 flex-1 flex-col gap-1 text-xs">
          Phone number
          <Input
            type="tel"
            value={phone}
            disabled={creating}
            autoComplete="tel"
            onChange={(event) => {
              setPhone(event.target.value);
            }}
          />
        </label>
        <Button type="submit" variant="outline" disabled={creating || phone.trim().length === 0}>
          <MessageSquare className="size-4" />
          {creating ? 'Adding…' : 'Add phone'}
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
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Disable ${point.valueMasked}`}
                    title={`Disable ${point.valueMasked}`}
                    disabled={savingId === point.id}
                    onClick={() => {
                      void onDisable(point.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
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
