'use client';

/**
 * `settings` — the data layer for the email-to-task (mail-ingest) section on the Automations page.
 *
 * @remarks
 * The write surface for `config.emailToTask = { enabled, threshold }` (validated by
 * `ConnectorConfig`) — the strictly-opt-in switch the ingest sweep reads. Split into two hooks so
 * the section and its rows stay pure: {@link useMailIngestList} reads the org's mail-capable
 * connections, and {@link useMailIngestRow} owns one connection's toggle + explicit sensitivity
 * threshold. The inbox itself is connected in **Connections**; this only turns the workflow on.
 * See `docs/engineering/specs/email-to-task.md`.
 */
import type { ConnectorConfig, IntegrationOut } from '@docket/types';
import { useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';

/**
 * The selectable funnel thresholds, with their numeric values visible.
 *
 * @remarks
 * Explicit by design: enabling always writes a concrete threshold (no hidden default), and the
 * number is shown so the setting stays legible ("Balanced (50)" — not a vibe).
 */
export const THRESHOLD_CHOICES: readonly { label: string; value: number }[] = [
  { label: 'Conservative (70) — only clearly actionable email', value: 70 },
  { label: 'Balanced (50) — actionable email with some judgment calls', value: 50 },
  { label: 'Eager (30) — most non-promotional email', value: 30 },
];

/** The mail-ingest list view model: which mail connections exist, and where to connect one. */
export interface MailIngestListModel {
  loading: boolean;
  /** Connected (or errored) mail-capable integrations — the rows the workflow can act on. */
  connected: readonly IntegrationOut[];
  /** Route to Connections, where a mail inbox is linked. */
  connectionsHref: string;
}

/** Read the org's mail-capable connections (today Gmail). */
export function useMailIngestList(orgId: string): MailIngestListModel {
  const integrationsQ = useApiQuery(
    apiQueryOptions(
      queryKeys.integrations(orgId),
      () => api.v1.orgs[':orgId'].integrations.$get({ param: { orgId } }),
      'Could not load integrations.',
    ),
  );
  const integrations: readonly IntegrationOut[] = integrationsQ.data?.items ?? [];
  const connected = integrations.filter(
    (i) => i.provider === 'gmail' && (i.status === 'connected' || i.status === 'error'),
  );
  return {
    loading: integrationsQ.isPending,
    connected,
    connectionsHref: `/orgs/${orgId}/settings/connections`,
  };
}

/** One mail connection's email-to-task view model. */
export interface MailIngestRowModel {
  /** The bound account label (or provider, as a fallback). */
  account: string;
  enabled: boolean;
  /** The threshold currently in effect (the saved one when enabled, else the pending selection). */
  activeThreshold: number;
  /** The pending sensitivity selection, honored on enable. */
  threshold: number;
  saving: boolean;
  error: string | null;
  /** Toggle the workflow on (with the current threshold) or off (removes the key entirely). */
  toggle: () => void;
  /** Change the sensitivity; persists immediately when already enabled. */
  changeSensitivity: (value: number) => void;
}

/** Own one mail connection's email-to-task toggle + explicit sensitivity threshold. */
export function useMailIngestRow(orgId: string, integration: IntegrationOut): MailIngestRowModel {
  const cfg = integration.config as ConnectorConfig;
  const current = cfg.emailToTask;
  const [threshold, setThreshold] = useState<number>(
    current === undefined ? 50 : current.threshold,
  );
  const [error, setError] = useState<string | null>(null);

  const save = useApiMutation({
    mutationFn: (emailToTask: { enabled: boolean; threshold: number } | undefined) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].integrations[':id'].$patch({
            param: { orgId, id: integration.id },
            json: {
              // Preserve every config key this row doesn't manage (listIds, teamId, …).
              config: { ...cfg, emailToTask },
            },
          }),
        'Could not save email-to-task settings.',
      ),
    invalidateKeys: [queryKeys.integrations(orgId)],
    onSuccess: () => {
      setError(null);
    },
    onError: (e: Error) => {
      setError(userErrorMessage(e, 'Could not save email-to-task settings.'));
    },
  });

  const enabled = current?.enabled === true;
  return {
    account: integration.connection.account ?? integration.provider,
    enabled,
    activeThreshold: current === undefined ? threshold : current.threshold,
    threshold,
    saving: save.isPending,
    error,
    toggle: () => {
      save.mutate(enabled ? undefined : { enabled: true, threshold });
    },
    changeSensitivity: (value) => {
      setThreshold(value);
      if (enabled) save.mutate({ enabled: true, threshold: value });
    },
  };
}
