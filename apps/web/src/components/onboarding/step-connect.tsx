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
 * Honesty: a provider is only offered as live when it is actually connectable. Availability comes
 * from the server's `/v1/config` (see `usePublicConfig`): in local dev the mock boundary adapter
 * backs every provider (all live, no OAuth), and in production a provider is live only when its
 * OAuth is configured server-side (its connector appears in `config.connectors`); otherwise the
 * card renders a calm, disabled "Available soon" state rather than a button that fails on click.
 *
 * Read-only mirror only: imported items become linked tasks whose external source stays
 * authoritative (no write-back, no take-over) — the import endpoint enforces this.
 */
import type { IntegrationCreate, IntegrationOut, TaskOut } from '@docket/types';
import { Calendar, Layers, TaskAlt } from '@docket/ui/icons';
import { type JSX, useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { connectorAvailable, usePublicConfig } from '@/lib/public-config';

import {
  type CardState,
  type ProviderCard,
  INITIAL_CARD_STATE,
  ProviderRow,
} from './step-connect-provider-row';

/** The exact set of sources onboarding offers, in display order. */
const ONBOARDING_PROVIDERS = ['calendar', 'gtasks', 'linear'] as const;

/** A source onboarding can mirror work from. */
export type OnboardingProvider = (typeof ONBOARDING_PROVIDERS)[number];

/**
 * The three onboarding sources.
 *
 * @remarks
 * Whether each is *live* is decided at render from the server's `/v1/config`
 * ({@link connectorAvailable}) — mock-backed in local dev, OAuth-gated in production — so the card
 * carries only its static presentation, never a build-time availability flag.
 */
const PROVIDER_CARDS: readonly ProviderCard<OnboardingProvider>[] = [
  {
    provider: 'calendar',
    name: 'Google Calendar',
    blurb: 'Pull your events in as upcoming time and deadlines.',
    icon: Calendar,
  },
  {
    provider: 'gtasks',
    name: 'Google Tasks',
    blurb: 'Bring your personal to-dos in as tasks you can act on.',
    icon: TaskAlt,
  },
  {
    provider: 'linear',
    name: 'Linear',
    blurb: 'Mirror your assigned issues so nothing gets lost in the move.',
    icon: Layers,
  },
];

/** Create an integration for a provider in the given org (the "Connect" call). */
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
  const { data: config } = usePublicConfig();
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

  /** A provider is live when the mock backs it (dev) or its OAuth is configured server-side. */
  const isLive = useCallback(
    (card: ProviderCard): boolean => connectorAvailable(config, card.provider),
    [config],
  );

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
