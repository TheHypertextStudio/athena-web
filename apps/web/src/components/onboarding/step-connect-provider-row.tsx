'use client';

import { Cable } from '@docket/ui/icons/cable';
import { CheckCircle2 } from '@docket/ui/icons/check-circle-2';
import type { DocketIcon } from '@docket/ui/icons/icon-type';
import { cn } from '@docket/ui/lib/utils';
import { Button, DecorativeIcon, Surface } from '@docket/ui/primitives';
import { useMemo, type JSX } from 'react';

/** Static presentation for one onboarding source. */
export interface ProviderCard<Provider extends string = string> {
  readonly provider: Provider;
  readonly name: string;
  readonly blurb: string;
  readonly icon: DocketIcon;
}

/** Where a single provider card is in its connect lifecycle. */
export type CardPhase = 'idle' | 'connecting' | 'connected' | 'error';

/** The mutable per-provider connect state. */
export interface CardState {
  readonly phase: CardPhase;
  readonly mirrored: number;
}

/** The initial state shared by every card. */
export const INITIAL_CARD_STATE: CardState = { phase: 'idle', mirrored: 0 };

/** The state after a connect attempt failed; the failure itself is presented as a notice. */
export const FAILED_CARD_STATE: CardState = { phase: 'error', mirrored: 0 };

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
    <Surface
      as="div"
      tone={connected ? 'prominent' : 'well'}
      shape="medium"
      pad="comfortable"
      className={cn(
        '@container grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-3 sm:flex sm:items-center sm:gap-4',
        !live && 'opacity-70',
      )}
    >
      <DecorativeIcon
        icon={connected ? CheckCircle2 : card.icon}
        className="shrink-0 @max-[16rem]:col-span-2"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5 break-words @max-[16rem]:col-span-2">
        <span className="text-on-surface text-body-medium leading-tight font-semibold">
          {card.name}
        </span>
        {connected ? (
          <span className="text-primary text-body-medium leading-snug">{mirroredLabel}</span>
        ) : (
          <span className="text-on-surface-variant text-body-medium leading-snug">
            {card.blurb}
          </span>
        )}
      </div>

      <div className="col-start-2 sm:ml-auto sm:shrink-0 @max-[16rem]:col-span-2 @max-[16rem]:col-start-1">
        {!live ? (
          <span className="text-on-surface-variant text-body-small font-medium">
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
            variant={phase === 'error' ? 'ghost' : 'secondary'}
            controlSize="md"
            onClick={onConnect}
            disabled={phase === 'connecting'}
            aria-label={
              phase === 'error' ? `Retry connecting ${card.name}` : `Connect ${card.name}`
            }
          >
            {/* placeholder: whether this provider connects — the outcome of an OAuth round trip
                that has left the page. Nothing is being hidden; the pulse is progress feedback on
                the caller's own in-flight action, beside copy that names it. */}
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
    </Surface>
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
