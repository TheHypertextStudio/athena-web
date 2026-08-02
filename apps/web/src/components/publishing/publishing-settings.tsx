'use client';

/**
 * `publishing` — the workspace's publishing settings surface (CORE-29 … CORE-32).
 *
 * @remarks
 * Three things in one place, in the order a person actually needs them:
 *
 * 1. **The workspace address.** The name published pages answer on at Docket's shared brief
 *    host. Every workspace needs one, and without it a published brief is not reachable at all —
 *    so it comes first and says so plainly.
 * 2. **Custom domains.** The optional upgrade for a workspace that owns a domain, with the exact
 *    DNS records to publish and an honest verification state.
 * 3. **Published pages.** What is currently readable on the web, so nobody has to remember.
 *
 * Everything here is administrator-only. The API refuses each write with 403 for anyone else and
 * the section is hidden from their nav; this component additionally refuses to render the domain
 * and address controls, so the gate holds even if someone types the URL.
 *
 * **Verification never lies.** A domain shows "verified" only when a DNS check just succeeded,
 * and a failure reports which of the three stable failure codes came back — never resolver text,
 * and never a cheerful "connected" over a check that did not pass.
 */
import type { WorkspaceDomainOut } from '@docket/types';
import { Globe } from '@docket/ui/icons';
import { Button, ControlGroup, Field, Input, Skeleton, Text } from '@docket/ui/primitives';
import { useEffect, useState, type JSX } from 'react';

import { SectionHeader } from '@/components/settings/section-header';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { userErrorMessage } from '@/lib/problem';

import {
  useAddDomainMutation,
  useClaimPublicNameMutation,
  usePublicationsQuery,
  usePublicNameQuery,
  useRemoveDomainMutation,
  useSuggestedNameQuery,
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
  const nameQ = usePublicNameQuery(orgId, canManage);
  const suggestedQ = useSuggestedNameQuery(orgId, canManage);
  const domainsQ = useWorkspaceDomainsQuery(orgId, canManage);
  const publicationsQ = usePublicationsQuery(orgId, canManage);
  const claimName = useClaimPublicNameMutation(orgId);
  const addDomain = useAddDomainMutation(orgId);

  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  useEffect(() => {
    const claimed = nameQ.data?.slug ?? null;
    if (claimed !== null) setName(claimed);
    else if (suggestedQ.data?.slug) setName(suggestedQ.data.slug);
  }, [nameQ.data, suggestedQ.data]);

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

  const claimed = nameQ.data?.slug ?? null;
  const domains = domainsQ.data?.items ?? [];
  const publications = publicationsQ.data?.items ?? [];
  const livePublications = publications.filter((publication) => publication.published);

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
          <Text as="p" token="body-medium" tone="muted">
            {claimed === null
              ? 'Published pages aren’t reachable until this workspace has an address.'
              : 'Changing this moves every published page in this workspace.'}
          </Text>
        </div>

        <Field
          label="Address"
          description={nameQ.data?.baseUrl ?? 'Lowercase letters, numbers, and hyphens.'}
          {...(claimName.error
            ? { error: userErrorMessage(claimName.error, 'Could not save that address.') }
            : {})}
        >
          <Input
            controlSize="lg"
            value={name}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <ControlGroup controlSize="lg">
          <Button
            disabled={claimName.isPending || name.length === 0 || name === claimed}
            onClick={() => {
              claimName.mutate(name);
            }}
          >
            {claimed === null ? 'Claim address' : 'Save address'}
          </Button>
        </ControlGroup>
      </section>

      <section aria-labelledby="custom-domains" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Text as="h3" id="custom-domains" token="title-small">
            Custom domains
          </Text>
          <Text as="p" token="body-medium" tone="muted">
            Serve published pages from a domain you own. A domain works only after DNS proves you
            own it, and a domain can belong to one workspace.
          </Text>
        </div>

        <Field
          label="Add a domain"
          description="For example, briefs.yourcompany.com"
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
            {livePublications.map((publication) => (
              <li
                key={publication.id}
                className="border-outline-variant flex items-center gap-3 border-b py-2 last:border-b-0"
              >
                <Globe aria-hidden className="text-on-surface-variant size-4 shrink-0" />
                <Text as="span" token="body-medium" truncate className="min-w-0 flex-1">
                  {publication.urls[0] ?? publication.path}
                </Text>
                <Text as="span" token="label-small" tone="muted">
                  {publication.subjectKind}
                </Text>
              </li>
            ))}
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
        <Button
          variant="secondary"
          disabled={verify.isPending}
          onClick={() => {
            verify.mutate(domain.id);
          }}
        >
          {domain.verified ? 'Re-check' : 'Check DNS'}
        </Button>
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
