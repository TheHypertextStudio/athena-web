'use client';

/**
 * `stream` — the source-attribution chip (a colored dot + provider name).
 *
 * @remarks
 * Heterogeneous events render through one homogeneous row; the source is shown here as a small
 * badge, not a per-source layout. Brand-ish dot colors keep Slack/Linear/GitHub/Docket instantly
 * recognizable; an unknown provider falls back to its raw name with a neutral dot.
 */
import { PROVIDER_CATALOG, type SourceSystemKind } from '@docket/types';
import type { JSX } from 'react';

const SOURCE_LABELS = Object.fromEntries(
  Object.values(PROVIDER_CATALOG).flatMap((entry) =>
    entry.sourceSystem ? [[entry.sourceSystem, entry.name]] : [],
  ),
);

const SYSTEM_COLORS: Record<string, string> = {
  docket: '#7a5cff',
  linear: '#5e6ad2',
  slack: '#611f69',
  discord: '#5865f2',
  github: '#1f2328',
  google_calendar: '#9a948c',
  gmail: '#9a948c',
  outlook: '#5c7fb8',
};

/** Props for {@link ProviderBadge}. */
export interface ProviderBadgeProps {
  /** The source system (`docket` | `linear` | `slack` | `discord` | `github` | `google_calendar` | `gmail` | `outlook`). */
  readonly system: SourceSystemKind;
}

/** A compact source-attribution badge for one stream event. */
export function ProviderBadge({ system }: ProviderBadgeProps): JSX.Element {
  const label = system === 'docket' ? 'Docket' : (SOURCE_LABELS[system] ?? system);
  const color = SYSTEM_COLORS[system] ?? '#9a948c';
  return (
    <span className="border-outline-variant text-on-surface-variant inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
