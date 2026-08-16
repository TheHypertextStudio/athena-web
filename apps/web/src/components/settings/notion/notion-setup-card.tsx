'use client';

/**
 * `settings/notion` — the one action that turns a design into real Notion databases.
 *
 * @remarks
 * Shown only while nothing has been provisioned, and shown *first*: it used to render below a
 * heading, a subtitle, and nine "Configure" rows for tables that did not exist, so the page's
 * primary action was its least prominent element.
 *
 * Three states matter as much as the happy one:
 *
 * - **Nothing chosen.** There is no implicit default any more. The old card fell back to
 *   `parentPages[0]`, so pressing Create without opening the dropdown built nine databases inside
 *   whichever page Notion happened to return first — in somebody else's workspace.
 * - **No pages shared.** A public Notion integration only sees what was ticked during consent, so
 *   this is a common first run, not a failure. It now offers to reopen that consent screen rather
 *   than instructing the reader to go use Notion's ••• menu and reload the page.
 * - **A run that failed.** The provision route answers 200 carrying a failed run, so the
 *   controller surfaces that as an error instead of letting it read as success.
 */
import type { NotionParentPageOut } from '@docket/connections/notion/mirror-contract';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { SettingsGroup } from '../settings-group';
import { useState } from 'react';

import {
  NO_PAGES_ACTION,
  NO_PAGES_HINT,
  SETUP_ACTION,
  SETUP_ACTION_BUSY,
  SETUP_BODY,
  SETUP_PAGE_LABEL,
  SETUP_RUNNING,
  SETUP_TITLE,
} from './notion-copy';
import { NotionConnectAction } from './notion-connect-action';
import { NotionParentPagePicker } from './notion-parent-page-picker';
import { useNotionParentPages, useNotionSetup } from './use-notion-mirror-controller';

/** Props for {@link NotionSetupCard}. */
export interface NotionSetupCardProps {
  orgId: string;
  integrationId: string;
  /**
   * Whether the caller may change this workspace's Notion setup.
   *
   * @remarks
   * Every write behind this surface is guarded server-side at `manage`
   * (`apps/api/src/routes/notion-mirror.ts`). Rendering the controls regardless meant a
   * contributor could press "Create databases" and receive a bare 403 with nothing explaining
   * it. Read stays available to everyone; only the write affordances are withheld.
   */
  canManage: boolean;
}

/** Choose a Notion page, then create the designed databases inside it. */
export function NotionSetupCard({
  orgId,
  integrationId,
  canManage,
}: NotionSetupCardProps): JSX.Element {
  const setup = useNotionSetup(orgId, integrationId);
  const [page, setPage] = useState<NotionParentPageOut | null>(null);
  const [query, setQuery] = useState('');

  // One search, owned here rather than inside the picker. The card has to answer a question the
  // picker cannot — "can this connection see any pages at all?", which decides between offering
  // the picker and offering re-consent — and that answer is the empty-term wave of the very same
  // search. Two hooks agreeing by cache key would give the same answer today and diverge the
  // moment either side changed its debounce or its default term.
  const search = useNotionParentPages(orgId, integrationId, query, true);
  const noPages =
    query === '' && !search.pending && search.error === null && search.pages.length === 0;

  return (
    <SettingsGroup title={SETUP_TITLE} description={SETUP_BODY}>
      {noPages ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-on-surface-variant text-body-small max-w-prose" role="note">
            {NO_PAGES_HINT}
          </p>
          <NotionConnectAction label={NO_PAGES_ACTION} disabled={!canManage} />
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          {/* A caption, not a `<label>`: the picker's affordance is a button, and a label that
              points at a button neither focuses it nor announces anything a screen reader wants.
              The accessible name comes from the picker's own `ariaLabel`. */}
          <div className="flex flex-col gap-1">
            <span className="text-on-surface-variant text-body-small">{SETUP_PAGE_LABEL}</span>
            <NotionParentPagePicker
              pages={search.pages}
              value={page}
              onChange={setPage}
              query={query}
              onQueryChange={setQuery}
              loading={search.pending}
              // Drop the term when the popover closes, so a shut picker stops holding an active
              // observer for `q=proj` that every window focus would refetch.
              onOpenChange={(open) => {
                if (!open) setQuery('');
              }}
              disabled={setup.creating}
            />
          </div>
          <Button
            disabled={setup.creating || page === null || !canManage}
            onClick={() => {
              if (page !== null) setup.create(page.id);
            }}
          >
            {setup.creating ? SETUP_ACTION_BUSY : SETUP_ACTION}
          </Button>
        </div>
      )}

      {setup.creating ? (
        <p className="text-on-surface-variant text-body-small" role="status">
          {SETUP_RUNNING}
        </p>
      ) : null}

      {(setup.error ?? search.error) ? (
        <p role="alert" className="text-error text-body-medium">
          {setup.error ?? search.error}
        </p>
      ) : null}
    </SettingsGroup>
  );
}
