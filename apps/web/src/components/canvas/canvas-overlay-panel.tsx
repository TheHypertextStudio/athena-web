'use client';

/** Keep Canvas chrome above XYFlow nodes, handles, edges, and selection geometry. */
import { cn } from '@docket/ui/lib/utils';
import { Panel } from '@xyflow/react';
import type { ComponentProps } from 'react';

/** Props accepted by the shared Canvas overlay panel. */
export type CanvasOverlayPanelProps = ComponentProps<typeof Panel>;

/** Render application chrome in the Canvas overlay layer. */
export default function CanvasOverlayPanel({
  className,
  ...props
}: CanvasOverlayPanelProps): React.JSX.Element {
  return <Panel {...props} className={cn('!z-[2000]', className)} />;
}
