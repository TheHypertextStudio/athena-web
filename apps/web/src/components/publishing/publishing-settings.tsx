'use client';

/**
 * `publishing` — the workspace's publishing settings surface (CORE-29 … CORE-32).
 *
 * @remarks
 * Two things in one place, in the order a person actually needs them:
 *
 * 1. **Custom domains.** A workspace that owns a domain can serve published pages from it, with
 *    the exact DNS records to publish and an honest verification state.
 * 2. **Published pages.** What is currently readable on the web, so nobody has to remember.
 *
 * The workspace's default address (the shared-host path segment its briefs answer on absent a
 * custom domain) is its own identity — edited in Settings → General, not here, since it is core
 * workspace identity and publishing is only one of its consumers. This page shows the resolved
 * result, read-only, with a link there.
 *
 * Domain management is administrator-only. The API refuses each domain write with 403 for anyone
 * else and the section is hidden from their nav; this component additionally refuses to render
 * the domain controls, so the gate holds even if someone types the URL.
 *
 * **Verification never lies.** A domain shows "verified" only when a DNS check just succeeded,
 * and a failure reports which of the three stable failure codes came back — never resolver text,
 * and never a cheerful "connected" over a check that did not pass.
 */
import { env } from '@docket/env/web';
import type { WorkspaceDomainOut } from '@docket/types';
import { Globe } from '@docket/ui/icons';
import { Button, ControlGroup, Field, Input, Skeleton, Text } from '@docket/ui/primitives';
import Link from 'next/link';
import { useEffect, useState, type JSX } from 'react';

import { api } from '@/lib/api';
import { SectionHeader } from '@/components/settings/section-header';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

import {
  useAddDomainMutation,
  usePublicationsQuery,
  useRemoveDomainMutation,
  useVerifyDomainMutation,
  useWorkspaceDomainsQuery,
} from './use-publishing';

/** Application-owned wording for each stable verification failure code. */
const VERIFY_FAILURE_COPY: Record<string, string> = {
  'lookup-failed': 'We couldn’t find that record yet. DNS changes can take up to an hour.',
  'no-record': 'No Docket verification record was found at that name yet.',
  'token-mismatch': 'A Docket record is there, but it carries a different code.',
};

/** Props for {@link PublishingSettings}. */
export interface PublishingSettingsProps {
  /** The workspace being configured. */
  readonly orgId: string;
}

/**
 * The publishing settings section.
 *
 * @param props - The {@link PublishingSettingsProps}.
 * @returns The rendered section.
 */
export function PublishingSettings({ orgId }: PublishingSettingsProps): JSX.Element {
  const { canManage, loading: permissionLoading } = useCanManageOrg(orgId);
  const orgQ = useApiQuery(
    apiQueryOptions(
      queryKeys.organization(orgId),
      () => api.v1.orgs[':orgId'].$get({ param: { orgId } }),
      'Could not load the workspace.',
      { enabled: canManage },
    ),
  );
  const domainsQ = useWorkspaceDomainsQuery(orgId, canManage);
  const publicationsQ = usePublicationsQuery(orgId, canManage);
  const addDomain = useAddDomainMutation(orgId);

  const [host, setHost] = useState('');

  if (permissionLoading) {
    return <Skeleton className="h-72 max-w-2xl rounded-lg" />;
  }

  if (!canManage) {
    return (
      <div className="flex flex-col gap-6">
        <SectionHeader
          title="Publishing"
          description="Choose the web address your published pages answer on."
        />
        <Text as="p" token="body-medium" tone="muted">
          Only workspace owners and admins can change where published pages answer.
        </Text>
      </div>
    );
  }

  const domains = domainsQ.data?.items ?? [];
  const publications = publicationsQ.data?.items ?? [];
  const livePublications = publications.filter((publication) => publication.published);
  const briefHost = env.NEXT_PUBLIC_BRIEF_HOST;
  const workspaceSlug = orgQ.data?.slug;
  const verifiedDomains = domains.filter((domain) => domain.verified);
  // A verified custom domain answers at its own root — no workspace segment, since the domain
  // already belongs to exactly this workspace — so it wins over the shared brief host, which
  // still needs the identity slug to disambiguate the many workspaces that share it.
  const reachableUrl =
    verifiedDomains[0] !== undefined
      ? `https://${verifiedDomains[0].host}/`
      : briefHost !== undefined && workspaceSlug !== undefined
        ? `https://${briefHost}/${workspaceSlug}/`
        : undefined;
  const extraVerifiedDomains = verifiedDomains[0] !== undefined ? verifiedDomains.length - 1 : 0;

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      <SectionHeader
        title="Publishing"
        description="Choose the web address your published pages answer on."
      />

      <section aria-labelledby="workspace-address" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Text as="h3" id="workspace-address" token="title-small">
            Workspace address
          </Text>
          {reachableUrl === undefined ? (
            <Text as="p" token="body-medium" tone="muted">
              Not reachable yet.
            </Text>
          ) : (
            <Text as="p" token="body-medium">
              <a
                href={reachableUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                {reachableUrl}
              </a>
              {extraVerifiedDomains > 0 ? ` +${String(extraVerifiedDomains)} more` : null}
            </Text>
          )}
        </div>

        <Field label="Identity" description="Edited in Settings → General.">
          <Input
            controlSize="lg"
            readOnly
            value={workspaceSlug ?? ''}
            {...(briefHost === undefined || workspaceSlug === undefined
              ? {}
              : { prefix: `${briefHost}/` })}
          />
        </Field>
        <ControlGroup controlSize="lg">
          <Button variant="secondary" asChild>
            <Link href={`/orgs/${orgId}/settings/general`}>Change in General settings</Link>
          </Button>
        </ControlGroup>
      </section>

      <section aria-labelledby="custom-domains" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Text as="h3" id="custom-domains" token="title-small">
            Custom domains
          </Text>
          <Text as="p" token="body-medium" tone="muted">
            Serve published pages from a domain you own.
          </Text>
        </div>

        <Field
          label="Add a domain"
          description="For example, updates.yourcompany.com"
          {...(addDomain.error
            ? { error: userErrorMessage(addDomain.error, 'Could not add that domain.') }
            : {})}
        >
          <Input
            controlSize="lg"
            value={host}
            spellCheck={false}
            autoComplete="off"
            inputMode="url"
            onChange={(event) => {
              setHost(event.target.value);
            }}
          />
        </Field>
        <ControlGroup controlSize="lg">
          <Button
            variant="secondary"
            disabled={addDomain.isPending || host.trim().length === 0}
            onClick={() => {
              addDomain.mutate(host.trim(), {
                onSuccess: () => {
                  setHost('');
                },
              });
            }}
          >
            Add domain
          </Button>
        </ControlGroup>

        {domainsQ.isPending ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : domains.length === 0 ? (
          <Text as="p" token="body-small" tone="muted">
            No custom domains yet.
          </Text>
        ) : (
          <ul className="flex flex-col gap-3">
            {domains.map((domain) => (
              <DomainRow key={domain.id} orgId={orgId} domain={domain} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="published-pages" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Text as="h3" id="published-pages" token="title-small">
            Published pages
          </Text>
          <Text as="p" token="body-medium" tone="muted">
            Everything in this workspace that anyone with the link can currently read.
          </Text>
        </div>
        {publicationsQ.isPending ? (
          <Skeleton className="h-20 rounded-lg" />
        ) : livePublications.length === 0 ? (
          <Text as="p" token="body-small" tone="muted">
            Nothing is published yet. Use the globe icon on an initiative, program, or project.
          </Text>
        ) : (
          <ul className="flex flex-col">
            {livePublications.map((publication) => {
              const url = publication.urls[0];
              return (
                <li
                  key={publication.id}
                  className="border-outline-variant flex items-center gap-3 border-b py-2 last:border-b-0"
                >
                  <Globe aria-hidden className="text-on-surface-variant size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    {url === undefined ? (
                      <Text as="span" token="body-medium" tone="muted" truncate>
                        Not reachable yet
                      </Text>
                    ) : (
                      <Text as="span" token="body-medium" truncate>
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-2"
                        >
                          {url}
                        </a>
                      </Text>
                    )}
                  </span>
                  <Text as="span" token="label-small" tone="muted">
                    {publication.subjectKind}
                  </Text>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One claimed domain: its state, the records to publish, and the actions on it. */
function DomainRow({
  orgId,
  domain,
}: {
  readonly orgId: string;
  readonly domain: WorkspaceDomainOut;
}): JSX.Element {
  const verify = useVerifyDomainMutation(orgId);
  const remove = useRemoveDomainMutation(orgId);
  const failure = verify.data?.failure ?? domain.lastFailure;

  useEffect(() => {
    // A "Verified" badge is a claim about DNS *right now*, not whenever someone last happened to
    // click a button — so re-confirm automatically on every view. If the record was removed since
    // the last check, the API's own verify handler already clears `verifiedAt`, and this row
    // re-renders into its unverified state (with the reason and the record to re-add) on its own.
    if (domain.verified) verify.mutate(domain.id);
  }, [domain.id]);

  return (
    <li className="bg-surface-container flex flex-col gap-3 rounded-xl p-4">
      <div className="flex items-center justify-between gap-3">
        <Text as="span" token="title-small" truncate className="min-w-0">
          {domain.host}
        </Text>
        <Text as="span" token="label-medium" tone={domain.verified ? 'default' : 'muted'}>
          {domain.verified ? 'Verified' : 'Not verified yet'}
        </Text>
      </div>

      {domain.verified ? null : (
        <div className="flex flex-col gap-2">
          <Text as="p" token="body-small" tone="muted">
            Add this record at your DNS provider, then check it.
          </Text>
          <DnsRecordLines record={domain.verificationRecord} />
          {failure ? (
            <Text as="p" token="body-small" tone="muted" role="status">
              {VERIFY_FAILURE_COPY[failure] ?? 'That record could not be confirmed yet.'}
            </Text>
          ) : null}
        </div>
      )}

      {domain.verified && domain.routingRecord ? (
        <div className="flex flex-col gap-2">
          <Text as="p" token="body-small" tone="muted">
            Point the domain at Docket with this record.
          </Text>
          <DnsRecordLines record={domain.routingRecord} />
        </div>
      ) : null}

      <ControlGroup controlSize="md">
        {domain.verified ? null : (
          <Button
            variant="secondary"
            disabled={verify.isPending}
            onClick={() => {
              verify.mutate(domain.id);
            }}
          >
            Check DNS
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={remove.isPending}
          onClick={() => {
            remove.mutate(domain.id);
          }}
        >
          Remove
        </Button>
      </ControlGroup>

      {verify.error || remove.error ? (
        <Text as="p" token="body-small" tone="error" role="alert">
          {userErrorMessage(verify.error ?? remove.error, 'Could not update this domain.')}
        </Text>
      ) : null}
    </li>
  );
}

/** One DNS record, shown verbatim and selectable so it can be copied field by field. */
function DnsRecordLines({
  record,
}: {
  readonly record: WorkspaceDomainOut['verificationRecord'];
}): JSX.Element {
  return (
    <dl className="flex flex-col gap-1">
      {(
        [
          ['Type', record.type],
          ['Name', record.name],
          ['Value', record.value],
        ] as const
      ).map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-3">
          <Text as="dt" token="label-small" tone="muted" className="w-12 shrink-0">
            {label}
          </Text>
          <Text as="dd" token="body-small" className="min-w-0 font-mono break-all">
            {value}
          </Text>
        </div>
      ))}
    </dl>
  );
}
