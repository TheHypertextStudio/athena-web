'use client';

import type { IntegrationOut } from '@docket/types';
import { Button, Select } from '@docket/ui/primitives';
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
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="text-on-surface text-label-large block truncate">{row.account}</span>
          <span className="text-on-surface-variant text-body-small block">
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
        <label className="text-on-surface-variant text-body-small flex items-center gap-2">
          Sensitivity
          <Select
            aria-label="Suggestion sensitivity"
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
          </Select>
        </label>
      ) : null}

      {row.enabled ? (
        <p className="text-on-surface-variant text-body-small">
          Default rules seeded — see the rules below.
        </p>
      ) : null}
      {row.error !== null ? <p className="text-error text-body-small">{row.error}</p> : null}
    </div>
  );
}
