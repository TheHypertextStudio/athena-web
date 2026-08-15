'use client';

/**
 * `publishing` — the rows of the workspace's address list.
 *
 * @remarks
 * Every address a workspace answers on is one kind of thing, so all of them are rows in one list:
 * the default address it always has, and each custom domain it has claimed. A row states the
 * address, whether it is the one visitors currently land on (`Primary`), and what stands between it
 * and working. There is no separate "here is the resolved address" summary above the list — the
 * `Primary` badge is that summary, attached to the row it describes.
 *
 * Row shape follows the contact-points rows on the notification settings surface: identity on the
 * left, badges for state, icon actions on the right, and any work the row still needs disclosed
 * underneath it rather than on another screen.
 */
import { PublicSlug, type WorkspaceDomainOut } from '@docket/types';
import { Check, Edit, Globe, Trash2, X } from '@docket/ui/icons';
import { Badge, Button, Input, Text } from '@docket/ui/primitives';
import { useEffect, useState, type JSX } from 'react';

import { SettingRowStatus } from '@/components/settings/setting-row-status';
import { userErrorMessage } from '@/lib/problem';
import { useDebouncedAutosave } from '@/lib/use-debounced-autosave';

import { DnsRecord } from './dns-record';
import {
  useRemoveDomainMutation,
  useRenameAddressMutation,
  useVerifyDomainMutation,
} from './use-publishing';

/** Application-owned wording for each stable verification failure code. */
const VERIFY_FAILURE_COPY: Record<string, string> = {
  'lookup-failed': 'We couldn’t find that record yet. DNS changes can take up to an hour.',
  'no-record': 'No Docket verification record was found at that name yet.',
  'token-mismatch': 'A Docket record is there, but it carries a different code.',
};

/** Indent that lines a row's disclosed content up with the address above it. */
const ROW_INDENT = 'pl-7';

/**
 * The one badge that answers "where do visitors actually land?".
 *
 * @remarks
 * The loudest treatment on the row, because it is the fact the old surface spent an entire section
 * restating above the list. Rendered only where the answer distinguishes one address from another:
 * a workspace with a single address has nothing for `Primary` to mean, and pairing it with that
 * row's own `Default` would be two badges for one fact — the duplication this surface exists to
 * have stopped doing.
 *
 * @returns The rendered badge.
 */
function PrimaryBadge(): JSX.Element {
  return (
    <Badge variant="default" className="shrink-0">
      Primary
    </Badge>
  );
}

/** Props for {@link DefaultAddressRow}. */
export interface DefaultAddressRowProps {
  /** The workspace whose address this is. */
  readonly orgId: string;
  /** The workspace's identity slug, which is the last segment of its default address. */
  readonly slug: string | undefined;
  /** The shared host published pages answer on, when this deployment has one. */
  readonly briefHost: string | undefined;
  /** Whether visitors currently land here (i.e. no custom domain has taken over). */
  readonly primary: boolean;
  /** Whether the caller may rename it. */
  readonly canManage: boolean;
}

/**
 * The address every workspace has: the shared host plus its identity slug.
 *
 * @remarks
 * Renaming happens in the row. The old surface showed this value in a read-only box with a button
 * to a different settings page — two controls to say "not here" — while the field itself rendered a
 * bare slug with nothing around it to say what it was. The row shows the whole address, so the slug
 * needs no caption explaining what it is part of.
 *
 * @param props - The {@link DefaultAddressRowProps}.
 * @returns The rendered row.
 */
export function DefaultAddressRow({
  orgId,
  slug,
  briefHost,
  primary,
  canManage,
}: DefaultAddressRowProps): JSX.Element {
  const rename = useRenameAddressMutation(orgId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!editing && slug !== undefined) setDraft(slug);
  }, [editing, slug]);

  const trimmed = draft.trim();
  const invalid = trimmed !== '' && !PublicSlug.safeParse(trimmed).success;
  const { flush } = useDebouncedAutosave({
    value: trimmed,
    baseline: slug,
    ready: editing && canManage && slug !== undefined,
    save: (next) => {
      if (PublicSlug.safeParse(next).success) rename.mutate(next);
    },
  });

  const address = briefHost === undefined || slug === undefined ? slug : `${briefHost}/${slug}`;
  const url =
    briefHost === undefined || slug === undefined ? undefined : `https://${briefHost}/${slug}/`;

  return (
    <li className="bg-surface-container-low flex flex-col gap-2 rounded-xl px-4 py-2">
      <div className="flex min-h-10 items-center gap-3">
        <Globe aria-hidden className="text-on-surface-variant size-4 shrink-0" />

        {editing ? (
          <div className="min-w-0 flex-1">
            <Input
              autoFocus
              value={draft}
              maxLength={64}
              spellCheck={false}
              autoComplete="off"
              aria-label="Workspace address"
              aria-invalid={invalid}
              {...(briefHost === undefined ? {} : { prefix: `${briefHost}/` })}
              onChange={(event) => {
                setDraft(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
              }}
            />
          </div>
        ) : (
          <span className="min-w-0 flex-1 truncate">
            {url === undefined ? (
              <Text as="span" token="body-medium" truncate>
                {address ?? ''}
              </Text>
            ) : (
              <Text as="span" token="body-medium" truncate>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {address}
                </a>
              </Text>
            )}
          </span>
        )}

        <Badge variant="secondary" className="shrink-0">
          {url === undefined ? 'Not reachable' : 'Default'}
        </Badge>
        {primary ? <PrimaryBadge /> : null}

        {canManage && slug !== undefined ? (
          editing ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Finish renaming"
              disabled={invalid}
              onClick={() => {
                flush();
                setEditing(false);
              }}
            >
              <Check className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Rename workspace address"
              onClick={() => {
                setEditing(true);
              }}
            >
              <Edit className="size-4" />
            </Button>
          )
        ) : null}
      </div>

      {editing ? (
        <div className={ROW_INDENT}>
          {invalid ? (
            <Text as="p" token="body-small" tone="error" role="alert">
              Use lowercase letters and numbers, separated by hyphens, and not a reserved name.
            </Text>
          ) : (
            <SettingRowStatus
              pending={rename.isPending}
              saved={rename.isSuccess}
              error={
                rename.error
                  ? userErrorMessage(rename.error, 'Could not change this address.')
                  : null
              }
            />
          )}
        </div>
      ) : null}
    </li>
  );
}

/** Props for {@link DomainRow}. */
export interface DomainRowProps {
  /** The workspace the domain belongs to. */
  readonly orgId: string;
  /** The claimed domain. */
  readonly domain: WorkspaceDomainOut;
  /** Whether visitors currently land here. */
  readonly primary: boolean;
}

/**
 * One claimed domain: its state, the records to publish, and the actions on it.
 *
 * @remarks
 * **Verification never lies.** A domain shows "Verified" only when a DNS check just succeeded, and
 * a failure reports which of the three stable failure codes came back — never resolver text, and
 * never a cheerful "connected" over a check that did not pass.
 *
 * Removal is destructive and takes the workspace's published pages offline with it, so it asks
 * once, in place, the way disabling a notification destination does.
 *
 * @param props - The {@link DomainRowProps}.
 * @returns The rendered row.
 */
export function DomainRow({ orgId, domain, primary }: DomainRowProps): JSX.Element {
  const verify = useVerifyDomainMutation(orgId);
  const remove = useRemoveDomainMutation(orgId);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const failure = verify.data?.failure ?? domain.lastFailure;

  useEffect(() => {
    // A "Verified" badge is a claim about DNS *right now*, not whenever someone last happened to
    // click a button — so re-confirm automatically on every view. If the record was removed since
    // the last check, the API's own verify handler already clears `verifiedAt`, and this row
    // re-renders into its unverified state (with the reason and the record to re-add) on its own.
    if (domain.verified) verify.mutate(domain.id);
  }, [domain.id]);

  return (
    <li className="bg-surface-container-low flex flex-col gap-3 rounded-xl px-4 py-2">
      <div className="flex min-h-10 items-center gap-3">
        <Globe aria-hidden className="text-on-surface-variant size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          <Text as="span" token="body-medium" truncate>
            {domain.verified ? (
              <a
                href={`https://${domain.host}/`}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                {domain.host}
              </a>
            ) : (
              domain.host
            )}
          </Text>
        </span>

        <Badge variant="secondary" className="shrink-0 gap-1">
          {domain.verified ? <Check aria-hidden className="size-3" /> : null}
          {domain.verified ? 'Verified' : 'Not verified'}
        </Badge>
        {primary ? <PrimaryBadge /> : null}

        {confirmingRemove ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`Confirm removing ${domain.host}`}
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate(domain.id);
              }}
            >
              <Trash2 className="size-4" />
              Confirm
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Cancel removing ${domain.host}`}
              onClick={() => {
                setConfirmingRemove(false);
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
            aria-label={`Remove ${domain.host}`}
            title={`Remove ${domain.host}`}
            disabled={remove.isPending}
            onClick={() => {
              setConfirmingRemove(true);
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      {domain.verified ? null : (
        <div className={`flex flex-col gap-2 ${ROW_INDENT}`}>
          <Text as="p" token="body-small" tone="muted">
            Add this record at your DNS provider, then check it.
          </Text>
          <div className="bg-surface-container rounded-lg px-3 py-2">
            <DnsRecord record={domain.verificationRecord} />
          </div>
          {failure ? (
            <Text as="p" token="body-small" tone="muted" role="status">
              {VERIFY_FAILURE_COPY[failure] ?? 'That record could not be confirmed yet.'}
            </Text>
          ) : null}
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={verify.isPending}
              onClick={() => {
                verify.mutate(domain.id);
              }}
            >
              {verify.isPending ? 'Checking…' : 'Check DNS'}
            </Button>
          </div>
        </div>
      )}

      {domain.verified && domain.routingRecord ? (
        <div className={`flex flex-col gap-2 ${ROW_INDENT}`}>
          <Text as="p" token="body-small" tone="muted">
            Point the domain at Docket with this record.
          </Text>
          <div className="bg-surface-container rounded-lg px-3 py-2">
            <DnsRecord record={domain.routingRecord} />
          </div>
        </div>
      ) : null}

      {verify.error || remove.error ? (
        <Text as="p" token="body-small" tone="error" role="alert" className={ROW_INDENT}>
          {userErrorMessage(verify.error ?? remove.error, 'Could not update this domain.')}
        </Text>
      ) : null}
    </li>
  );
}
