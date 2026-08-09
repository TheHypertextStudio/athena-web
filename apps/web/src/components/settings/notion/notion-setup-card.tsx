'use client';

/**
 * `settings/notion` — the one action that turns a design into real Notion databases.
 *
 * @remarks
 * Shown only while nothing has been provisioned. It exists because the hub previously *told* the
 * reader to "create them in your Notion workspace" and gave them no way to do it — the central
 * action of the feature had no affordance at all.
 *
 * Two states matter as much as the happy one. A workspace that shared no pages during consent gets
 * an explanation and a route forward, not an empty dropdown; and a provision run that fails still
 * returns HTTP 200 carrying a failed run, so the controller surfaces that as an error rather than
 * letting it read as success.
 */
import { Button, Select } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useState } from 'react';

import { useNotionSetup } from './use-notion-mirror-controller';

/** Props for {@link NotionSetupCard}. */
export interface NotionSetupCardProps {
  orgId: string;
  integrationId: string;
}

/** Choose a Notion page, then create the designed databases inside it. */
export function NotionSetupCard({ orgId, integrationId }: NotionSetupCardProps): JSX.Element {
  const setup = useNotionSetup(orgId, integrationId);
  const [pageId, setPageId] = useState('');

  const chosen = pageId || (setup.parentPages[0]?.id ?? '');
  const noPages = !setup.loading && setup.parentPages.length === 0;

  return (
    <div className="border-primary/40 bg-surface-container-low flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <p className="text-on-surface text-label-large">Create these in Notion</p>
        <p className="text-on-surface-variant text-body-small mt-1 max-w-prose">
          Docket will build the databases below inside a page you choose, then keep them current.
          Nothing is created until you do this.
        </p>
      </div>

      {noPages ? (
        <p className="text-on-surface-variant text-body-small max-w-prose" role="note">
          Docket can’t see any Notion pages yet. In Notion, open the page you want these to live
          under, then share it with Docket from the ••• menu — and reload this page.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-on-surface-variant text-body-small">Build them under</span>
            <Select
              value={chosen}
              disabled={setup.loading || setup.creating}
              onChange={(e) => {
                setPageId(e.target.value);
              }}
              className="w-64 max-w-full"
            >
              {setup.parentPages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.title}
                </option>
              ))}
            </Select>
          </label>
          <Button
            disabled={setup.creating || chosen.length === 0}
            onClick={() => {
              setup.create(chosen);
            }}
          >
            {setup.creating ? 'Creating…' : 'Create in Notion'}
          </Button>
        </div>
      )}

      {setup.creating ? (
        <p className="text-on-surface-variant text-body-small" role="status">
          Building your databases and filling them in. This can take a minute for a large workspace
          — you can leave this page.
        </p>
      ) : null}

      {setup.error !== null ? (
        <p role="alert" className="text-error text-body-medium">
          {setup.error}
        </p>
      ) : null}
    </div>
  );
}
