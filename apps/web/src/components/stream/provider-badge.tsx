'use client';

/**
 * `stream` — the source-attribution chip (a colored dot + provider name).
 *
 * @remarks
 * Heterogeneous events render through one homogeneous row; the source is shown here as a small
 * badge, not a per-source layout. Brand-ish dot colors keep Slack/Linear/GitHub/Docket instantly
 * recognizable; an unknown provider falls back to its raw name with a neutral dot.
 */
import type { SourceSystemKind } from '@docket/types';
import type { JSX } from 'react';

const SYSTEMS: Record<string, { readonly label: string; readonly color: string }> = {
  docket: { label: 'Docket', color: '#7a5cff' },
  linear: { label: 'Linear', color: '#5e6ad2' },
  slack: { label: 'Slack', color: '#611f69' },
  discord: { label: 'Discord', color: '#5865f2' },
  github: { label: 'GitHub', color: '#1f2328' },
  google_calendar: { label: 'Google Calendar', color: '#9a948c' },
  gmail: { label: 'Gmail', color: '#9a948c' },
  outlook: { label: 'Outlook', color: '#5c7fb8' },
};

/** Props for {@link ProviderBadge}. */
export interface ProviderBadgeProps {
  /** The source system (`docket` | `linear` | `slack` | `discord` | `github` | `google_calendar` | `gmail` | `outlook`). */
  readonly system: SourceSystemKind;
}

/** A compact source-attribution badge for one stream event. */
export function ProviderBadge({ system }: ProviderBadgeProps): JSX.Element {
  const meta = SYSTEMS[system] ?? { label: system, color: '#9a948c' };
  return (
    <span className="border-outline-variant text-on-surface-variant inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: meta.color }}
      />
      {meta.label}
    </span>
  );
}
