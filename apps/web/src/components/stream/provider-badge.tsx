'use client';

/**
 * `stream` — the source-attribution chip (a colored dot + provider name).
 *
 * @remarks
 * Heterogeneous events render through one homogeneous row; the source is shown here as a small
 * badge, not a per-source layout. Brand-ish dot colors keep Slack/Linear/GitHub/Docket instantly
 * recognizable; an unknown provider falls back to its raw name with a neutral dot.
 */
import type { JSX } from 'react';

const PROVIDERS: Record<string, { readonly label: string; readonly color: string }> = {
  docket: { label: 'Docket', color: '#7a5cff' },
  linear: { label: 'Linear', color: '#5e6ad2' },
  slack: { label: 'Slack', color: '#611f69' },
  github: { label: 'GitHub', color: '#1f2328' },
};

/** Props for {@link ProviderBadge}. */
export interface ProviderBadgeProps {
  /** The source provider (`docket` | `linear` | `slack` | `github` | …). */
  readonly provider: string;
}

/** A compact source-attribution badge for one stream event. */
export function ProviderBadge({ provider }: ProviderBadgeProps): JSX.Element {
  const meta = PROVIDERS[provider] ?? { label: provider, color: '#9a948c' };
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
