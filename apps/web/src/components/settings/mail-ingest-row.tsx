'use client';

import type { IntegrationOut } from '@docket/types';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { THRESHOLD_CHOICES, useMailIngestRow } from './use-mail-ingest-controller';

/** Props for {@link MailIngestRow}. */
export interface MailIngestRowProps {
  orgId: string;
  integration: IntegrationOut;
  canManage: boolean;
}

/**
 * One mail connection's email-to-task toggle + explicit sensitivity row.
 *
 * @remarks
 * The row's behavior (toggle, threshold persistence, error) lives in {@link useMailIngestRow}; this
 * component is the thin per-row binding plus its markup. Enabling submits both `enabled` and an
 * explicit numeric threshold (no hidden default) while preserving sibling config keys.
 */
export function MailIngestRow({ orgId, integration, canManage }: MailIngestRowProps): JSX.Element {
  const row = useMailIngestRow(orgId, integration);

  return (
    <div className="border-outline-variant bg-surface-container-low flex flex-col gap-2 rounded-lg border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="text-on-surface block truncate text-sm font-medium">{row.account}</span>
          <span className="text-on-surface-variant block text-xs">
            {row.enabled
              ? `Creating task suggestions from email (threshold ${String(row.activeThreshold)})`
              : 'Athena reads new mail and proposes tasks in triage — strictly opt-in.'}
          </span>
        </span>
        {canManage ? (
          <Button
            size="sm"
            variant={row.enabled ? 'outline' : 'default'}
            disabled={row.saving}
            onClick={row.toggle}
          >
            {row.enabled ? 'Turn off' : 'Turn on'}
          </Button>
        ) : null}
      </div>

      {canManage ? (
        <label className="text-on-surface-variant flex items-center gap-2 text-xs">
          Sensitivity
          <select
            aria-label="Suggestion sensitivity"
            className="border-outline-variant bg-surface rounded-md border px-2 py-1"
            value={row.enabled ? row.activeThreshold : row.threshold}
            disabled={row.saving}
            onChange={(e) => {
              row.changeSensitivity(Number(e.target.value));
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

      {row.enabled ? (
        <p className="text-on-surface-variant text-xs">
          Default rules seeded — see the rules below.
        </p>
      ) : null}
      {row.error !== null ? <p className="text-destructive text-xs">{row.error}</p> : null}
    </div>
  );
}
