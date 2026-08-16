'use client';

/**
 * `publishing` — the workspace's publishing settings surface.
 *
 * @remarks
 * Two lists, in the order a person actually needs them:
 *
 * 1. **Addresses.** Every web address this workspace answers on — the default one it always has,
 *    and each custom domain it has claimed — as rows of one list, with `Primary` marking the one
 *    visitors land on today.
 * 2. **Published pages.** What is currently readable on the web, so nobody has to remember.
 *
 * The surface used to open with a separate "Workspace address" section restating whichever address
 * had won, above the list that produced it: the same host printed twice, under two different
 * headings, with the default address rendered as a read-only box and a button to go edit it
 * somewhere else. One list of rows says all of it once, and the rename happens in the row.
 *
 * Domain management is administrator-only. The API refuses each domain write with 403 for anyone
 * else and the section is hidden from their nav; this component additionally refuses to render the
 * domain controls, so the gate holds even if someone types the URL.
 */
import { env } from '@docket/env/web';
import { Globe, Plus } from '@docket/ui/icons';
import { Button, Input, Skeleton, Text } from '@docket/ui/primitives';
import { useState, type JSX, type SyntheticEvent } from 'react';

import { api } from '@/lib/api';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';
import { SettingsSubsection } from '@/components/settings/settings-subsection';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

import { DefaultAddressRow, DomainRow } from './address-rows';
import {
  useAddDomainMutation,
  usePublicationsQuery,
  useWorkspaceDomainsQuery,
} from './use-publishing';

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

  const [adding, setAdding] = useState(false);
  const [host, setHost] = useState('');

  if (permissionLoading) {
    return <Skeleton className="h-72 rounded-xl" />;
  }

  if (!canManage) {
    return (
      <SettingsSectionPage sectionKey="publishing">
        <Text as="p" token="body-medium" tone="muted">
          Only workspace owners and admins can change this.
        </Text>
      </SettingsSectionPage>
    );
  }

  const domains = domainsQ.data?.items ?? [];
  const publications = publicationsQ.data?.items ?? [];
  const livePublications = publications.filter((publication) => publication.published);
  // A verified custom domain answers at its own root — no workspace segment, since the domain
  // already belongs to exactly this workspace — so it wins over the shared brief host, which still
  // needs the identity slug to disambiguate the many workspaces that share it.
  const primaryDomain = domains.find((domain) => domain.verified);
  // `Primary` answers "which of these?", so it appears only where there is more than one address to
  // choose between. A deployment with no shared brief host has no default address at all, so the
  // default row cannot hold the mark even when it is the only row.
  const defaultReachable =
    env.NEXT_PUBLIC_BRIEF_HOST !== undefined && orgQ.data?.slug !== undefined;
  const marksPrimary = domains.length > 0;

  const submitDomain = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const value = host.trim();
    if (value === '') return;
    addDomain.mutate(value, {
      onSuccess: () => {
        setHost('');
        setAdding(false);
      },
    });
  };

  return (
    <SettingsSectionPage sectionKey="publishing">
      <SettingsSubsection
        title="Addresses"
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={adding}
            onClick={() => {
              setAdding((open) => !open);
            }}
          >
            {adding ? null : <Plus aria-hidden className="size-4" />}
            {adding ? 'Cancel' : 'Add domain'}
          </Button>
        }
      >
        {adding ? (
          <form
            onSubmit={submitDomain}
            className="flex flex-col gap-2 @2xl:flex-row @2xl:items-center"
          >
            <div className="min-w-0 flex-1">
              <Input
                autoFocus
                value={host}
                spellCheck={false}
                autoComplete="off"
                inputMode="url"
                placeholder="updates.yourcompany.com"
                aria-label="Domain to add"
                onChange={(event) => {
                  setHost(event.target.value);
                }}
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              disabled={addDomain.isPending || host.trim().length === 0}
            >
              {addDomain.isPending ? 'Adding…' : 'Add domain'}
            </Button>
          </form>
        ) : null}

        {addDomain.error ? (
          <Text as="p" token="body-small" tone="error" role="alert">
            {userErrorMessage(addDomain.error, 'Could not add that domain.')}
          </Text>
        ) : null}

        <ul className="flex flex-col gap-2">
          <DefaultAddressRow
            orgId={orgId}
            slug={orgQ.data?.slug}
            briefHost={env.NEXT_PUBLIC_BRIEF_HOST}
            primary={marksPrimary && defaultReachable && primaryDomain === undefined}
            canManage={canManage}
          />
          {domainsQ.isPending ? (
            <li>
              <Skeleton className="h-14 rounded-xl" />
            </li>
          ) : (
            domains.map((domain) => (
              <DomainRow
                key={domain.id}
                orgId={orgId}
                domain={domain}
                primary={marksPrimary && domain.id === primaryDomain?.id}
              />
            ))
          )}
        </ul>
      </SettingsSubsection>

      <SettingsSubsection title="Published pages">
        {publicationsQ.isPending ? (
          <Skeleton className="h-20 rounded-lg" />
        ) : livePublications.length === 0 ? (
          <Text as="p" token="body-small" tone="muted">
            Nothing is published yet. Use the globe icon on an initiative, program, or project.
          </Text>
        ) : (
          <ul className="flex flex-col gap-2">
            {livePublications.map((publication) => {
              const url = publication.urls[0];
              return (
                <li
                  key={publication.id}
                  className="bg-surface-container-low flex min-h-14 items-center gap-3 rounded-xl px-4 py-2"
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
      </SettingsSubsection>
    </SettingsSectionPage>
  );
}
