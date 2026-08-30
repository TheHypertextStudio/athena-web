'use client';

/** Shared page presentation for standalone Focus. */
import { ShellTopBar } from '@docket/ui/components';
import { Surface } from '@docket/ui/primitives';
import type { ReactNode } from 'react';

import { usePersistedDensity } from '@/hooks/use-persisted-density';

/** The two Focus presentations share content and controls but not their enclosing geometry. */
export type FocusPresentation = 'rail' | 'page';

/** Props for {@link FocusRouteFrame}. */
export interface FocusRouteFrameProps {
  /** The authenticated person whose density preference scopes this route. */
  readonly userId: string | null;
  /** Leading navigation control for the shared compact top bar. */
  readonly navigation: ReactNode;
  /** Title for the shared compact top bar. */
  readonly title: ReactNode;
  /** Optional controls at the right of the shared compact top bar. */
  readonly actions?: ReactNode | undefined;
  /** The route's Focus content. */
  readonly children: ReactNode;
}

/**
 * Frame Focus on the same canvas, page surface, top bar, and density contract as the app shell.
 *
 * Focus owns ordinary document scrolling on its page route. It does not nest a scroll region under
 * the fixed top bar, which keeps a long task context and today's ledger in one continuous page.
 */
export default function FocusRouteFrame({
  userId,
  navigation,
  title,
  actions,
  children,
}: FocusRouteFrameProps): React.JSX.Element {
  const density = usePersistedDensity(userId);

  return (
    <Surface
      tone="canvas"
      shape="none"
      data-testid="focus-route-frame"
      data-density={density}
      className="min-h-dvh lg:p-2"
    >
      <Surface
        as="main"
        tone="page"
        shape="none"
        className="flex min-h-dvh flex-col lg:min-h-[calc(100dvh-1rem)] lg:rounded-xl"
      >
        <ShellTopBar navigation={navigation} title={title} actions={actions} />
        {children}
      </Surface>
    </Surface>
  );
}
