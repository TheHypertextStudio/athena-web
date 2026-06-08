'use client';

/**
 * `onboarding/step-connect` — the live "bring in your work" beat.
 *
 * @remarks
 * The pivotal onboarding screen: the workspace already exists (the orchestrator creates it
 * before this step), so each provider here genuinely connects and mirrors real work into it.
 * A provider card runs a two-call flow on Connect — create the integration, then import — and
 * reports the count of items it mirrored. Connecting is per-card and repeatable, so the user
 * can pull from several sources before entering the workspace; the orchestrator owns the
 * skip / enter action row.
 *
 * Honesty: a provider is only offered as live when it is actually connectable. In local dev
 * (`NEXT_PUBLIC_APP_MODE=local`) the mock boundary adapter backs every provider, so all three
 * are live with no OAuth. In production a provider is live only when its OAuth is wired (its
 * `NEXT_PUBLIC_CONNECTOR_*` flag is set); otherwise the card renders a calm, disabled
 * "Available soon" state rather than a button that would fail on click.
 *
 * Read-only mirror only: imported items become linked tasks whose external source stays
 * authoritative (no write-back, no take-over) — the import endpoint enforces this.
 */
import type { IntegrationCreate, IntegrationOut, TaskOut } from '@docket/types';
import { Cable, Calendar, CheckCircle2, Layers, TaskAlt } from '@docket/ui/icons';
import type { LucideIcon } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

/** The exact set of sources onboarding offers, in display order. */
const ONBOARDING_PROVIDERS = ['calendar', 'gtasks', 'linear'] as const;

/** A source onboarding can mirror work from. */
export type OnboardingProvider = (typeof ONBOARDING_PROVIDERS)[number];

/** Static presentation for one onboarding source. */
interface ProviderCard {
  /** The connector provider key the API understands. */
  readonly provider: OnboardingProvider;
  /** The product name shown on the card. */
  readonly name: string;
  /** One plain-language line: what connecting this brings in. */
  readonly blurb: string;
  /** The leading glyph. */
  readonly icon: LucideIcon;
  /**
   * The build-inlined public flag whose truthiness means this provider's OAuth is wired in
   * production. Read via DOT-notation `process.env.NEXT_PUBLIC_*` below so the Next/Turbopack
   * bundler statically inlines it into the client bundle.
   */
  readonly prodEnabled: boolean;
}

/** Truthy only for a non-empty, non-`"false"`/`"0"` public flag value. */
function isEnabled(flag: string | undefined): boolean {
  if (!flag) return false;
  const normalized = flag.trim().toLowerCase();
  return normalized.length > 0 && normalized !== 'false' && normalized !== '0';
}

/**
 * Whether this deployment runs against the mock boundary adapters (local dev), in which
 * case every provider is connectable without OAuth.
 *
 * @remarks
 * Read via DOT-notation `process.env.NEXT_PUBLIC_APP_MODE` so Next/Turbopack statically inlines
 * the literal into the client bundle (a bracket/computed lookup is NOT inlined and reads as
 * `undefined` in the browser). `local` means the MockConnector backs every provider, so the
 * connect flow works end-to-end with no real credentials.
 */
function isMockMode(): boolean {
  return process.env.NEXT_PUBLIC_APP_MODE === 'local';
}

/**
 * The three onboarding sources, each carrying whether its production OAuth is configured.
 *
 * @remarks
 * The `prodEnabled` flags are read via DOT-notation `process.env.NEXT_PUBLIC_…` accesses (never
 * a bracket/computed key) so Next/Turbopack statically inlines them into the client bundle,
 * mirroring the sign-in OAuth gate. In local dev these are blank — availability comes from
 * {@link isMockMode}.
 */
const PROVIDER_CARDS: readonly ProviderCard[] = [
  {
    provider: 'calendar',
    name: 'Google Calendar',
    blurb: 'Pull your events in as upcoming time and deadlines.',
    icon: Calendar,
    prodEnabled: isEnabled(process.env.NEXT_PUBLIC_CONNECTOR_CALENDAR),
  },
  {
    provider: 'gtasks',
    name: 'Google Tasks',
    blurb: 'Bring your personal to-dos in as tasks you can act on.',
    icon: TaskAlt,
    prodEnabled: isEnabled(process.env.NEXT_PUBLIC_CONNECTOR_GTASKS),
  },
  {
    provider: 'linear',
    name: 'Linear',
    blurb: 'Mirror your assigned issues so nothing gets lost in the move.',
    icon: Layers,
    prodEnabled: isEnabled(process.env.NEXT_PUBLIC_CONNECTOR_LINEAR),
  },
];

/** Where a single provider card is in its connect lifecycle. */
type CardPhase = 'idle' | 'connecting' | 'connected' | 'error';

/** The mutable per-provider connect state. */
interface CardState {
  /** The lifecycle phase this card is in. */
  readonly phase: CardPhase;
  /** Count of items mirrored once `connected` (0 is valid — nothing new to mirror). */
  readonly mirrored: number;
  /** A human-readable failure message when `phase === 'error'`. */
  readonly error: string | null;
}

/** The initial state shared by every card. */
const INITIAL_CARD_STATE: CardState = { phase: 'idle', mirrored: 0, error: null };

/**
 * Create an integration for a provider in the given org (the "Connect" call).
 *
 * @remarks
 * Created as a read-only mirror (`pattern: 'connector'`, `syncMode: 'mirror'`) regardless of
 * the provider's directory pattern, because onboarding mirrors work rather than taking a tool
 * over. No OAuth fields are needed against the mock; in prod the connection credential is
 * resolved server-side from the deployment's configured OAuth.
 */
async function defaultCreateIntegration(
  orgId: string,
  provider: OnboardingProvider,
): Promise<Response> {
  const json: IntegrationCreate = {
    provider,
    pattern: 'connector',
    roles: ['work'],
    syncMode: 'mirror',
  };
  return api.v1.orgs[':orgId'].integrations.$post({ param: { orgId }, json });
}

/**
 * Run the import for a just-created integration (mirrors its work into the org).
 *
 * @remarks
 * Sends `assignToImporter: true` so each mirrored item is assigned to the onboarding owner —
 * the mirrored work then lands under My Work's "Assigned to me", so "Enter your workspace"
 * opens onto a visibly populated landing screen rather than an empty-looking My Work.
 */
function defaultImportWork(orgId: string, integrationId: string): Promise<Response> {
  return api.v1.orgs[':orgId'].integrations[':id'].import.$post({
    param: { orgId, id: integrationId },
    json: { assignToImporter: true },
  });
}

/** Props for {@link StepConnect}. */
export interface StepConnectProps {
  /** The freshly-created org the connect flow mirrors work into. */
  orgId: string;
  /**
   * Notified with the running total of items mirrored across all providers, so the
   * orchestrator can promote its primary action to "Enter your workspace" once anything
   * has been brought in.
   */
  onMirroredTotalChange?: (total: number) => void;
  /** Override for the create-integration call (defaults to the real RPC); injected in tests. */
  createIntegration?: (orgId: string, provider: OnboardingProvider) => Promise<Response>;
  /** Override for the import call (defaults to the real RPC); injected in tests. */
  importWork?: (orgId: string, integrationId: string) => Promise<Response>;
}

/**
 * The live connect-and-mirror step.
 *
 * @remarks
 * Renders the three onboarding sources. Each available card connects on click (create
 * integration → import) and then shows how many items it mirrored; an unavailable provider
 * (prod, OAuth not wired) shows a disabled "Available soon" state. The action row (skip /
 * enter) is owned by the orchestrator.
 */
export function StepConnect({
  orgId,
  onMirroredTotalChange,
  createIntegration = defaultCreateIntegration,
  importWork = defaultImportWork,
}: StepConnectProps): JSX.Element {
  const [states, setStates] = useState<Record<OnboardingProvider, CardState>>({
    calendar: INITIAL_CARD_STATE,
    gtasks: INITIAL_CARD_STATE,
    linear: INITIAL_CARD_STATE,
  });

  /**
   * The running total of items mirrored across all providers, derived from `states`. Reported
   * to the orchestrator in an effect (never inside a state updater) so we don't update the
   * parent while this component is rendering.
   */
  const mirroredTotal = ONBOARDING_PROVIDERS.reduce((sum, key) => sum + states[key].mirrored, 0);
  useEffect(() => {
    onMirroredTotalChange?.(mirroredTotal);
  }, [mirroredTotal, onMirroredTotalChange]);

  /** A provider is live when the mock backs it (dev) or its prod OAuth is configured. */
  const isLive = useCallback((card: ProviderCard): boolean => isMockMode() || card.prodEnabled, []);

  /** Connect a single provider: create the integration, then import its work. */
  const connect = useCallback(
    async (provider: OnboardingProvider): Promise<void> => {
      setStates((prev) => ({
        ...prev,
        [provider]: { phase: 'connecting', mirrored: 0, error: null },
      }));
      try {
        const createRes = await createIntegration(orgId, provider);
        if (!createRes.ok) {
          const message = await readProblem(createRes, 'Could not connect this source.');
          setStates((prev) => ({
            ...prev,
            [provider]: { phase: 'error', mirrored: 0, error: message },
          }));
          return;
        }
        const created = (await createRes.json()) as IntegrationOut;

        const importRes = await importWork(orgId, created.id);
        if (!importRes.ok) {
          const message = await readProblem(importRes, 'Connected, but could not bring work in.');
          setStates((prev) => ({
            ...prev,
            [provider]: { phase: 'error', mirrored: 0, error: message },
          }));
          return;
        }
        const { items } = (await importRes.json()) as { items: TaskOut[] };

        setStates((prev) => ({
          ...prev,
          [provider]: { phase: 'connected' as const, mirrored: items.length, error: null },
        }));
      } catch (caught) {
        const message = readError(caught, 'Something went wrong connecting this source.');
        setStates((prev) => ({
          ...prev,
          [provider]: { phase: 'error', mirrored: 0, error: message },
        }));
      }
    },
    [orgId, createIntegration, importWork],
  );

  return (
    <ul className="flex flex-col gap-3">
      {PROVIDER_CARDS.map((card) => (
        <li key={card.provider}>
          <ProviderRow
            card={card}
            live={isLive(card)}
            state={states[card.provider]}
            onConnect={() => {
              void connect(card.provider);
            }}
          />
        </li>
      ))}
    </ul>
  );
}

/** Props for a single provider row. */
interface ProviderRowProps {
  /** The provider's static presentation. */
  card: ProviderCard;
  /** Whether this provider is actually connectable in this deployment. */
  live: boolean;
  /** The provider's current connect state. */
  state: CardState;
  /** Invoked when the user clicks Connect. */
  onConnect: () => void;
}

/**
 * One provider's row: icon + name + blurb on the left, the connect affordance on the right.
 *
 * @remarks
 * The right side reflects the card's phase: a Connect button while idle, a calm progress
 * label while connecting, a confirmed "Mirrored N items" once done (with a Retry for
 * failures), or a disabled "Available soon" when the provider is not connectable here.
 */
function ProviderRow({ card, live, state, onConnect }: ProviderRowProps): JSX.Element {
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
        <span className="text-on-surface text-sm leading-tight font-semibold">{card.name}</span>
        {connected ? (
          <span className="text-primary text-sm leading-snug">{mirroredLabel}</span>
        ) : phase === 'error' ? (
          <span role="alert" className="text-destructive text-sm leading-snug">
            {state.error}
          </span>
        ) : (
          <span className="text-on-surface-variant text-sm leading-snug">{card.blurb}</span>
        )}
      </div>

      <div className="ml-auto shrink-0">
        {!live ? (
          <span className="text-on-surface-variant border-outline-variant rounded-md border px-3 py-1.5 text-xs font-medium">
            Available soon
          </span>
        ) : connected ? (
          <span className="text-primary inline-flex items-center gap-1.5 text-sm font-medium">
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
 * @remarks
 * Re-importing is idempotent, so a second connect can legitimately mirror nothing new — the
 * copy stays honest and reassuring in that case rather than implying a failure.
 *
 * @param count - The number of items mirrored on this connect.
 * @param name - The provider's display name.
 * @returns the user-facing confirmation sentence.
 */
function mirroredText(count: number, name: string): string {
  if (count === 0) return `${name} is connected — nothing new to bring in.`;
  if (count === 1) return `Mirrored 1 item from ${name}.`;
  return `Mirrored ${count} items from ${name}.`;
}
