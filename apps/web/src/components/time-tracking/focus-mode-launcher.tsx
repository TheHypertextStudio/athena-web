'use client';

/** Entry controls for immersive Focus, pinned to the working companion's endpoint. */
import { useMediaQuery } from '@docket/ui/hooks';
import { Maximize } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';

import { launchFocusMode } from './focus-window';

/** Open immersive Focus as a pop-out, with an explicit same-tab alternative. */
export default function FocusModeLauncher(): JSX.Element {
  const router = useRouter();
  const mobile = useMediaQuery('(max-width: 767px), (pointer: coarse)');

  return (
    <div className="flex shrink-0 flex-col gap-1.5 px-3 pt-2 pb-3">
      <Button
        variant="secondary"
        controlSize="sm"
        className="min-h-10 w-full"
        onClick={() => {
          const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
          launchFocusMode({
            open: (url, target, features) => window.open(url, target, features),
            navigate: (href) => {
              router.push(href);
            },
            mobile,
            returnPath,
          });
        }}
      >
        <Maximize aria-hidden="true" />
        Open focus mode
      </Button>
      <Button
        variant="ghost"
        controlSize="sm"
        className="hidden min-h-10 w-full md:inline-flex"
        onClick={() => {
          const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
          launchFocusMode({
            open: () => null,
            navigate: (href) => {
              router.push(href);
            },
            mobile: true,
            returnPath,
          });
        }}
      >
        Open in this tab
      </Button>
    </div>
  );
}
