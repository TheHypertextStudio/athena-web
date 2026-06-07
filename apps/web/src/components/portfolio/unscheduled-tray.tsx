'use client';

/**
 * The "unscheduled" tray for the Hub Portfolio: Project bars that carry no dates and so can't
 * be placed on the time axis.
 *
 * @remarks
 * A dateless Project still belongs to its org's roadmap, so rather than dropping it the
 * roadmap collects it into a clearly-labelled tray beneath the dated bars. Each entry is a
 * compact, health-dotted chip that deep-links to the Project detail — keyboard-focusable, with
 * a focus ring — so the work stays reachable without pretending to a position it doesn't have.
 */
import type { Health, HubProjectBar } from '@docket/types';
import { cn } from '@docket/ui';
import Link from 'next/link';
import type { JSX } from 'react';

import { statusLabel } from './format';
import { asHealth, fillFor, labelFor } from './health';

/** Props for {@link UnscheduledTray}. */
export interface UnscheduledTrayProps {
  /** The dateless project bars to surface. */
  bars: readonly HubProjectBar[];
  /** Whether the tray is dimmed (another org is focused). */
  dimmed: boolean;
}

/**
 * Render the unscheduled tray, or nothing when there are no dateless bars.
 *
 * @param props - The {@link UnscheduledTrayProps}.
 * @returns the tray, or null.
 */
export function UnscheduledTray({ bars, dimmed }: UnscheduledTrayProps): JSX.Element | null {
  if (bars.length === 0) return null;
  return (
    <div className={cn('flex flex-col gap-1.5 pt-1', dimmed && 'opacity-30')}>
      <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        Unscheduled
      </span>
      <ul className="flex flex-wrap gap-1.5">
        {bars.map((bar) => {
          const health: Health | null = asHealth(bar.health);
          return (
            <li key={bar.id}>
              <Link
                href={`/orgs/${bar.organizationId}/projects/${bar.id}`}
                aria-label={`${bar.name} — ${statusLabel(bar.status)}, unscheduled, ${labelFor(health)}`}
                className="border-outline-variant bg-surface-container-low hover:bg-surface-container-high focus-visible:ring-ring inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
              >
                <span aria-hidden="true" className={cn('size-2 rounded-full', fillFor(health))} />
                <span className="text-foreground max-w-[14rem] truncate">{bar.name}</span>
                <span className="text-muted-foreground">{statusLabel(bar.status)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
