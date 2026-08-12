import type { JSX } from 'react';

import { Text } from '@docket/ui/primitives';

import { ProductScreenshot } from './product-screenshot';

/**
 * Show the Docket Pro MCP surface without implying a vendor approval program.
 *
 * @remarks
 * Deliberately smaller than the sections above it. MCP access is one Docket Pro capability, not
 * the product's primary positioning and not a list of clients Docket has chosen to permit.
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
            MCP connections
          </Text>
          <Text
            as="p"
            token="body-large"
            tone="inherit"
            className="text-ink-muted mt-3 text-balance"
          >
            Docket Pro includes an MCP endpoint for work stored in Docket.
          </Text>
        </div>
        <ProductScreenshot
          src="/marketing/connected-apps.jpg"
          alt="A connected MCP app in Docket settings"
          aspect="aspect-[2/1]"
          tone="paper"
          position="center"
        />
      </div>
    </section>
  );
}
