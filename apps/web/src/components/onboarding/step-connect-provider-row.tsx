'use client';

import type { LucideIcon } from '@docket/ui/icons';
import { Cable, CheckCircle2 } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import { useMemo, type JSX } from 'react';

/** Static presentation for one onboarding source. */
export interface ProviderCard<Provider extends string = string> {
  readonly provider: Provider;
  readonly name: string;
  readonly blurb: string;
  readonly icon: LucideIcon;
}

/** Where a single provider card is in its connect lifecycle. */
export type CardPhase = 'idle' | 'connecting' | 'connected' | 'error';

/** The mutable per-provider connect state. */
export interface CardState {
  readonly phase: CardPhase;
  readonly mirrored: number;
  readonly error: string | null;
}

/** The initial state shared by every card. */
export const INITIAL_CARD_STATE: CardState = { phase: 'idle', mirrored: 0, error: null };

/** Props for a single provider row. */
export interface ProviderRowProps<Provider extends string = string> {
  card: ProviderCard<Provider>;
  live: boolean;
  state: CardState;
  onConnect: () => void;
}

/**
 * One provider's row: icon + name + blurb on the left, the connect affordance on the right.
 *
 * Right side reflects the card's phase: Connect while idle, progress while connecting,
 * confirmed "Mirrored N items" once done, or disabled "Available soon" when not connectable.
 */
export function ProviderRow<Provider extends string = string>({
  card,
  live,
  state,
  onConnect,
}: ProviderRowProps<Provider>): JSX.Element {
  const { phase } = state;
  const connected = phase === 'connected';
  const mirroredLabel = useMemo(() => mirroredText(state.mirrored, card.name), [state, card.name]);

  return (
    <div
      className={cn(
        'border-outline-variant bg-surface-container-low flex items-center gap-4 rounded-xl border p-4 transition-colors',
        connected && 'border-primary/40 bg-primary/5',
        !live && 'opacity-70',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg border',
          connected
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-outline-variant bg-surface-container text-on-surface-variant',
        )}
      >
        {connected ? <CheckCircle2 className="size-5" /> : <card.icon className="size-5" />}
      </span>

      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-on-surface text-body-medium leading-tight font-semibold">{card.name}</span>
        {connected ? (
          <span className="text-primary text-body-medium leading-snug">{mirroredLabel}</span>
        ) : phase === 'error' ? (
          <span role="alert" className="text-destructive text-body-medium leading-snug">
            {state.error}
          </span>
        ) : (
          <span className="text-on-surface-variant text-body-medium leading-snug">{card.blurb}</span>
        )}
      </div>

      <div className="ml-auto shrink-0">
        {!live ? (
          <span className="text-on-surface-variant border-outline-variant rounded-md border px-3 py-1.5 text-xs font-medium">
            Available soon
          </span>
        ) : connected ? (
          <span className="text-primary text-body-medium inline-flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="size-4" />
            Connected
          </span>
        ) : (
          <Button
            type="button"
            variant={phase === 'error' ? 'outline' : 'secondary'}
            size="sm"
            onClick={onConnect}
            disabled={phase === 'connecting'}
            aria-label={
              phase === 'error' ? `Retry connecting ${card.name}` : `Connect ${card.name}`
            }
          >
            {phase === 'connecting' ? (
              <>
                <Cable className="size-4 animate-pulse" />
                Connecting…
              </>
            ) : phase === 'error' ? (
              'Retry'
            ) : (
              <>
                <Cable className="size-4" />
                Connect
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The confirmation line shown once a provider is connected.
 *
 * Re-importing is idempotent, so a second connect can mirror nothing new — the copy stays
 * honest and reassuring rather than implying a failure.
 */
export function mirroredText(count: number, name: string): string {
  if (count === 0) return `${name} is connected — nothing new to bring in.`;
  if (count === 1) return `Mirrored 1 item from ${name}.`;
  return `Mirrored ${count} items from ${name}.`;
}
