'use client';

import type { JSX, ReactNode } from 'react';
import { Surface } from '../../primitives/surface';

/** Two activity panels retain their mounted content when their visibility changes. */
export interface ActivityPanelsProps {
  readonly primary: ReactNode;
  readonly secondary: ReactNode;
  readonly showPrimary: boolean;
  readonly showSecondary: boolean;
}

/** Compose a centered activity from one or two readable panels, stacking on narrow windows. */
export function ActivityPanels({
  primary,
  secondary,
  showPrimary,
  showSecondary,
}: ActivityPanelsProps): JSX.Element {
  return (
    <div
      className={`grid min-w-0 items-start gap-4 ${showPrimary && showSecondary ? '@4xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]' : ''}`}
    >
      <Surface
        tone="card"
        pad="tight"
        className="sm:p-4"
        hidden={!showPrimary}
        data-activity-panel="primary"
      >
        {primary}
      </Surface>
      <Surface
        tone="card"
        pad="tight"
        className="sm:p-4"
        hidden={!showSecondary}
        data-activity-panel="secondary"
      >
        {secondary}
      </Surface>
    </div>
  );
}
