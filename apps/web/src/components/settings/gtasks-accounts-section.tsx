'use client';

/**
 * `settings` — the Google Tasks connections section (one connection per linked identity).
 *
 * @remarks
 * The thin composition for the Google Tasks multi-account surface: it calls
 * {@link useGtasksController} (the data layer) and arranges the pure content pieces — the identity
 * {@link GtasksIdentityPicker} and each {@link GtasksAccountRow} — inside a {@link SettingsSubsection}.
 * It holds no fetching, mutation, or state of its own.
 *
 * Linking/unlinking Google accounts happens under **Connected accounts**, not here: accounts are
 * user-level identities; a connection is an org-level choice of identity + resources (task lists).
 */
import type { IntegrationDirectoryProvider, IntegrationOut, TeamOut } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { Button, Skeleton } from '@docket/ui/primitives';
import { Plus, TaskAlt } from '@docket/ui/icons';
import type { JSX } from 'react';

import { DisconnectConfirmDialog } from './disconnect-confirm-dialog';
import { GtasksAccountRow } from './gtasks-account-row';
import { GtasksIdentityPicker } from './gtasks-identity-picker';
import { SettingsGroup } from './settings-group';
import { SETTINGS_NODES } from './settings-capabilities';
import { useGtasksController } from './use-gtasks-controller';

/** Props for {@link GtasksAccountsSection}. */
export interface GtasksAccountsSectionProps {
  /** The active organization id. */
  orgId: string;
  /** Whether the caller can manage integrations. */
  canManage: boolean;
  /** The Google Tasks directory entry (for the default roles on create). */
  directory: IntegrationDirectoryProvider;
  /** The org's existing Google Tasks connections — one per bound identity. */
  accounts: readonly IntegrationOut[];
  /** Teams in the org (for each connection's target-team selector). */
  teams: readonly TeamOut[];
  /** Whether the integrations list is still loading (avoids a premature empty flash). */
  loading: boolean;
}

/** The Google Tasks connections section. */
export function GtasksAccountsSection(props: GtasksAccountsSectionProps): JSX.Element {
  const controller = useGtasksController(props);
  const { orgId, canManage, teams, picker, addError, loading, rows, confirm } = controller;

  return (
    <SettingsGroup
      capability={SETTINGS_NODES.connectionsGoogleTasks}
      body="rows"
      action={
        // While the list is empty the empty state carries the action, so the header does not offer
        // the same thing twice — the rule the rest of Settings already follows.
        canManage && (rows.length > 0 || picker.open) ? (
          <Button
            controlSize="md"
            variant="ghost"
            aria-expanded={picker.open}
            onClick={picker.toggle}
          >
            <Plus aria-hidden="true" className="size-4" />
            {picker.open ? 'Close' : 'Connect account'}
          </Button>
        ) : undefined
      }
    >
      {picker.open ? <GtasksIdentityPicker picker={picker} orgId={orgId} /> : null}

      {addError ? (
        <p role="alert" className="text-error text-body-medium px-4 pb-3">
          {addError}
        </p>
      ) : null}

      {/* placeholder: the Google Tasks connections on this workspace — which accounts are
          connected and which task lists they sync. The section heading, the connect action and the
          empty-state copy are all static and render around this branch. */}
      {loading ? (
        <Skeleton className="m-4 h-20 rounded-xl" />
      ) : rows.length === 0 && !picker.open ? (
        <EmptyState
          icon={TaskAlt}
          title="No Google Tasks connections yet"
          body={
            canManage
              ? 'Connect a linked Google account to sync its task lists.'
              : 'An admin can connect a Google account to sync its task lists.'
          }
          frame="none"
          {...(canManage ? { cta: { label: 'Connect account', onClick: picker.toggle } } : {})}
        />
      ) : (
        <ul>
          {rows.map((row) => (
            <GtasksAccountRow
              key={row.account.id}
              row={row}
              orgId={orgId}
              teams={teams}
              canManage={canManage}
            />
          ))}
        </ul>
      )}

      <DisconnectConfirmDialog
        providerName={confirm.target?.providerName ?? null}
        onConfirm={confirm.confirm}
        onCancel={confirm.cancel}
      />
    </SettingsGroup>
  );
}
