/**
 * `settings` — the email-to-task enablement section for mail integrations.
 *
 * @remarks
 * The write surface for `config.emailToTask = { enabled, threshold }` (validated by
 * `ConnectorConfig`) — the strictly-opt-in switch the ingest sweep reads. One row per
 * connected mail integration: a toggle plus an explicit sensitivity choice (the funnel
 * threshold — its numeric value is shown, never hidden). Enabling also seeds the org's
 * default automation rules server-side, so the rules appear under Settings → Automations
 * the moment the feature turns on. See `docs/engineering/specs/email-to-task.md`.
 */
'use client';

import type { ConnectorConfig, IntegrationOut } from '@docket/types';
import { Button } from '@docket/ui/primitives';
import NextLink from 'next/link';
import { type JSX, useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { queryKeys, unwrap, useApiMutation } from '@/lib/query';

/**
 * The selectable funnel thresholds, with their numeric values visible.
 *
 * @remarks
 * Explicit by design: enabling always writes a concrete threshold (no hidden default), and
 * the number is shown so the setting stays legible ("Balanced (50)" — not a vibe).
 */
const THRESHOLD_CHOICES: readonly { label: string; value: number }[] = [
  { label: 'Conservative (70) — only clearly actionable email', value: 70 },
  { label: 'Balanced (50) — actionable email with some judgment calls', value: 50 },
  { label: 'Eager (30) — most non-promotional email', value: 30 },
];

/** Props for {@link MailIngestRow}. */
interface MailIngestRowProps {
  orgId: string;
  integration: IntegrationOut;
  canManage: boolean;
}

/** One mail integration's email-to-task toggle + threshold row. */
function MailIngestRow({ orgId, integration, canManage }: MailIngestRowProps): JSX.Element {
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
  const activeThreshold = current === undefined ? threshold : current.threshold;
  const account = integration.connection.account ?? integration.provider;

  return (
    <div className="border-outline-variant bg-surface-container-low flex flex-col gap-2 rounded-lg border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="text-on-surface block truncate text-sm font-medium">{account}</span>
          <span className="text-on-surface-variant block text-xs">
            {enabled
              ? `Creating task suggestions from email (threshold ${String(activeThreshold)})`
              : 'Athena reads new mail and proposes tasks in triage — strictly opt-in.'}
          </span>
        </span>
        {canManage ? (
          <Button
            size="sm"
            variant={enabled ? 'outline' : 'default'}
            disabled={save.isPending}
            onClick={() => {
              save.mutate(enabled ? undefined : { enabled: true, threshold });
            }}
          >
            {enabled ? 'Turn off' : 'Turn on'}
          </Button>
        ) : null}
      </div>

      {canManage ? (
        <label className="text-on-surface-variant flex items-center gap-2 text-xs">
          Sensitivity
          <select
            aria-label="Suggestion sensitivity"
            className="border-outline-variant bg-surface rounded-md border px-2 py-1"
            value={enabled ? activeThreshold : threshold}
            disabled={save.isPending}
            onChange={(e) => {
              const value = Number(e.target.value);
              setThreshold(value);
              if (enabled) save.mutate({ enabled: true, threshold: value });
            }}
          >
            {THRESHOLD_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {enabled ? (
        <NextLink
          href={`/orgs/${orgId}/settings/automations`}
          className="text-primary w-fit text-xs font-medium hover:underline"
        >
          Default rules seeded — review them under Automations
        </NextLink>
      ) : null}
      {error !== null ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

/** Props for {@link MailIngestSection}. */
interface MailIngestSectionProps {
  orgId: string;
  canManage: boolean;
  /** The org's connected mail-capable integrations (today Gmail; Outlook next). */
  integrations: readonly IntegrationOut[];
}

/**
 * The email-to-task section: one enablement row per connected mail integration.
 *
 * @remarks
 * Absent entirely (not an empty box) when the org has no connected mail integration —
 * connecting the account happens in the provider directory above.
 */
export function MailIngestSection({
  orgId,
  canManage,
  integrations,
}: MailIngestSectionProps): JSX.Element | null {
  const connected = integrations.filter((i) => i.status === 'connected' || i.status === 'error');
  if (connected.length === 0) return null;

  return (
    <section aria-label="Email to task" className="flex flex-col gap-3">
      <h2 className="text-on-surface-variant text-xs font-medium">Email to task</h2>
      {connected.map((integration) => (
        <MailIngestRow
          key={integration.id}
          orgId={orgId}
          integration={integration}
          canManage={canManage}
        />
      ))}
    </section>
  );
}
