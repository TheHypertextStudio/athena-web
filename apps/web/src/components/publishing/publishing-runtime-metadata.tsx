'use client';

import { Button, Text } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { usePublicConfig } from '@/lib/public-config';

import { DefaultAddressRow, type DefaultAddressRowProps } from './address-rows';

/** Runtime default-address state; custom domains and publishing mutations remain independent. */
export interface PublishingRuntimeMetadata {
  readonly briefHost: string | undefined;
  readonly availability?: 'loading' | 'error' | undefined;
  readonly notice?: JSX.Element;
}

/** Read only in a Workers child; Node retains its existing environment-owned address. */
export function useWorkersPublishingMetadata(): PublishingRuntimeMetadata {
  const config = usePublicConfig();
  if (config.isPending)
    return {
      briefHost: undefined,
      availability: 'loading',
      notice: (
        <Text as="p" token="body-small" tone="muted">
          Loading default address…
        </Text>
      ),
    };
  if (config.isError || config.data.briefHost === undefined)
    return {
      briefHost: undefined,
      availability: 'error',
      notice: (
        <>
          <Text as="p" token="body-small" tone="muted">
            Could not load the default address.
          </Text>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              void config.refetch();
            }}
          >
            Try again
          </Button>
        </>
      ),
    };
  return { briefHost: config.data.briefHost ?? undefined };
}

/** Leave custom-domain rows visible while default-address metadata is pending or unavailable. */
export function PublishingDefaultAddress({
  metadata,
  ...props
}: Omit<DefaultAddressRowProps, 'briefHost'> & {
  readonly metadata: PublishingRuntimeMetadata;
}): JSX.Element {
  return (
    <>
      <DefaultAddressRow
        {...props}
        briefHost={metadata.briefHost}
        availability={metadata.availability}
      />
      {metadata.notice ? <li>{metadata.notice}</li> : null}
    </>
  );
}

/** The shared-host address prefix retains the workspace segment. */
export function publishingAddressPrefix(
  briefHost: string | undefined,
  workspaceSlug: string | undefined,
): string | undefined {
  return briefHost !== undefined && workspaceSlug !== undefined
    ? `${briefHost}/${workspaceSlug}/`
    : undefined;
}
