import type { JSX } from 'react';

import { Text } from '@docket/ui/primitives';

import { PlaceholderSurface } from './placeholder-surface';

/**
 * Let your agents work with you — the shortest section on the page.
 *
 * @remarks
 * Deliberately smaller than the sections above it. Agents matter, but an equal-sized block here
 * would put connecting an MCP client on the same footing as tracking a task, which is not the
 * order someone evaluates the product in.
 *
 * The plate is a wide strip rather than a screen, since what there is to show is a client window
 * next to Docket rather than a Docket surface.
 */
export function AgentsStrip(): JSX.Element {
  return (
    <section className="border-outline-variant border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-16 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-14">
        <div>
          <Text
            as="h2"
            token="headline-large"
            tone="inherit"
            className="font-display text-ink text-balance"
          >
            Let your agents work with you
          </Text>
          <Text
            as="p"
            token="body-large"
            tone="inherit"
            className="text-ink-muted mt-3 text-balance"
          >
            Ask an AI assistant about your tasks today and it has nothing to look at unless you copy
            your list into the chat by hand. An agent connected to Docket over MCP reads your actual
            projects and updates status directly, so there is nothing to copy.
          </Text>
        </div>
        <PlaceholderSurface
          label="An MCP client connected to Docket"
          aspect="aspect-[2/1]"
          tone="paper"
        />
      </div>
    </section>
  );
}
