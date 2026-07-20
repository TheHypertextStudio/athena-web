'use client';

/**
 * `settings` — the **Import** panel: move everything from another tool into Docket, once.
 *
 * @remarks
 * The composition for the Import feature — a flat list of migration providers with a one-time-import
 * framing. Deliberately spare compared to {@link ConnectionsPanel}: no scope header, no Google Tasks
 * or Calendar sections, no effect copy. It shares only the {@link useIntegrationsData} plumbing and
 * the {@link ProviderCategorySection} content.
 */
import type { JSX } from 'react';

import { IntegrationsIntro } from './integrations-intro';
import { DisconnectConfirmDialog } from './disconnect-confirm-dialog';
import { IntegrationsStatus } from './integrations-status';
import { ProviderCategorySection } from './provider-category-section';
import { useImportController } from './use-import-controller';

/** Props for {@link ImportPanel}. */
export interface ImportPanelProps {
  orgId: string;
  canManage: boolean;
}

/** The Import settings panel (one-time migration). */
export function ImportPanel({ orgId, canManage }: ImportPanelProps): JSX.Element {
  const c = useImportController({ orgId, canManage });

  return (
    <IntegrationsStatus loading={c.loading} loadError={c.loadError}>
      <div className="flex flex-col gap-6">
        <IntegrationsIntro
          text={c.intro.text}
          crossHref={c.intro.crossHref}
          crossText={c.intro.crossText}
        />

        {c.categories.map((section) => (
          <ProviderCategorySection
            key={section.category}
            label={section.label}
            rows={section.rows}
            orgId={c.orgId}
            teams={c.teams}
            canManage={c.canManage}
          />
        ))}

        <DisconnectConfirmDialog
          providerName={c.confirm.target?.providerName ?? null}
          onConfirm={c.confirm.confirm}
          onCancel={c.confirm.cancel}
        />
      </div>
    </IntegrationsStatus>
  );
}
