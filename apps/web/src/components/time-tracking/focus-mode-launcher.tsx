'use client';

/** Entry controls for immersive Focus, pinned to the working companion's endpoint. */
import { useMediaQuery } from '@docket/ui/hooks';
import { ChevronDown, Maximize } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import type { JSX } from 'react';

import { launchFocusMode } from './focus-window';

/** Open immersive Focus as a pop-out, with an explicit same-tab alternative. */
export default function FocusModeLauncher(): JSX.Element {
  const router = useRouter();
  const mobile = useMediaQuery('(max-width: 767px), (pointer: coarse)');
  const openFocus = (sameTab: boolean): void => {
    const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    launchFocusMode({
      open: sameTab ? () => null : (url, target, features) => window.open(url, target, features),
      navigate: (href) => {
        router.push(href);
      },
      mobile: sameTab || mobile,
      returnPath,
    });
  };

  return (
    <div className="flex shrink-0 justify-end px-3 pt-2 pb-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" controlSize="sm" className="min-h-10">
            <Maximize aria-hidden="true" />
            Focus mode
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              openFocus(false);
            }}
          >
            Open focus mode
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              openFocus(true);
            }}
          >
            Open in this tab
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
