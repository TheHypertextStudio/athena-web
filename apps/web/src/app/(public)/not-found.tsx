import { Text } from '@docket/ui/primitives';
import type { JSX } from 'react';

/**
 * The `(public)` group's not-found page.
 *
 * @remarks
 * Reached whenever a brief is unpublished, never existed, or is not permitted on the host the
 * visitor asked on — all one outcome on purpose, so nobody can tell those apart by probing.
 *
 * It says nothing about workspaces, records, or permissions. "This brief has been unpublished"
 * would confirm that the address was real, which is information the publisher deliberately
 * withdrew. It also carries no link back into the product: an anonymous visitor holding a dead
 * link has no business being pushed toward a sign-in screen.
 */
export default function PublicNotFound(): JSX.Element {
  return (
    <main className="brief-column mx-auto flex min-h-dvh w-full max-w-[36rem] flex-col justify-center gap-3 px-5 py-12 sm:px-8">
      <Text as="h1" token="headline-small">
        This page isn’t available
      </Text>
      <Text as="p" token="body-large" className="brief-muted">
        The address may be mistyped, or the page may no longer be published.
      </Text>
    </main>
  );
}
