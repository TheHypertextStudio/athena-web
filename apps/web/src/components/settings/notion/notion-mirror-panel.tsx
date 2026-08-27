'use client';

/**
 * `settings/notion` — the Docket-in-Notion hub.
 *
 * @remarks
 * The surface is **state-driven and quiet when nothing is wrong**: a status strip, an attention
 * block that renders only when there is something to act on, then the list of designed databases.
 * That ordering is deliberate. The page it replaces was a settings dump where a healthy
 * connection and a broken one looked identical, so the only way to learn something needed doing
 * was to read every row.
 *
 * The page has two shapes, because before and after provisioning it answers different questions.
 *
 * **Before** the only question is "how do I start", so the setup card comes first and the nine
 * tables collapse into a preview. They used to be nine expanded rows with nine "Configure"
 * buttons for tables that did not exist — the primary action outnumbered nine to one by
 * secondary ones, all of them offering to customize something not yet built.
 *
 * **After**, the questions are "where did they go" and "how do I get to one", so the container
 * page is named and every row links out to the real database. Both facts were already stored and
 * neither was rendered: `containerPageId` went into the connector config and was never shown
 * again, and each row's `externalUrl` was read from Notion at provision time and dropped.
 *
 * Pure presentation — all reads and writes live in `use-notion-mirror-controller.ts`.
 */
import type { NotionMirrorDatabaseOut } from '@docket/connections/notion/mirror-contract';
import { WriteError } from '../write-error';
import { ArrowRight, CheckCircle2, CircleAlert, LayoutTemplate, OpenInNew } from '@docket/ui/icons';
import { EmptyState } from '@docket/ui/components';
import { Button, Skeleton } from '@docket/ui/primitives';
import NextLink from '@/components/docket-link';
import type { JSX } from 'react';

import { CardAlert, CardNote } from '../card-note';
import { SettingsGroup } from '../settings-group';
import { SETTINGS_NODES } from '../settings-capabilities';
import { CONNECTION_ERROR_MESSAGE, integrationStatusLabel } from '../integration-status';

import {
  CONNECTION_ERROR_DETAIL,
  CONTAINER_LABEL,
  CONTAINER_NOTE,
  CONTAINER_UNKNOWN,
  EMPTY_DATABASE_HINT,
  MIRROR_FAILED_TITLE,
  PAGE_CONTENT_PERMISSION_DETAIL,
  PAGE_CONTENT_PERMISSION_TITLE,
  PAGE_CONTENT_TRUNCATED_DETAIL,
  PAGE_CONTENT_TRUNCATED_TITLE,
  syncFailureCopy,
  OPEN_IN_NOTION,
  RECONNECT_ACTION,
  SETUP_BLOCKED,
  SYNC_ACTION,
  SYNC_ACTION_BUSY,
  tableAction,
  entityLabel,
  previewSummary,
  tableMeaning,
} from './notion-copy';
import { NotionConnectAction } from './notion-connect-action';
import { NotionSetupCard } from './notion-setup-card';
import {
  useNotionMirror,
  useNotionMirrorSync,
  useNotionPeople,
} from './use-notion-mirror-controller';

/** Props for {@link NotionMirrorPanel}. */
export interface NotionMirrorPanelProps {
  /** The active workspace. */
  orgId: string;
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

/**
 * One table in the hub list: what it does, and the way in.
 *
 * @remarks
 * Row counts are gone. "Projects · 4" answers a question nobody has, while the thing a reader
 * actually wants — will my Notion edits survive, and how do I change what appears — was invisible:
 * the only affordance used to be the table's name, styled as body text.
 *
 * The action reads "Customize" before the table exists and "Configure" after, because those are
 * different offers: one shapes something about to be built, the other changes something live.
 */
function DatabaseRow({
  database,
  designHref,
}: {
  database: NotionMirrorDatabaseOut;
  designHref: string;
}): JSX.Element {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 @lg:flex-row @lg:items-center @lg:gap-4">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-on-surface text-label-large">{database.title}</span>
        <span className="text-on-surface-variant text-body-small">
          {tableMeaning(database.direction, entityLabel(database.entityType))}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-3 self-start @lg:self-auto">
        {database.externalUrl !== null ? (
          <a
            href={database.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="text-on-surface-variant text-label-large hover:text-on-surface inline-flex items-center gap-1"
          >
            {OPEN_IN_NOTION}
            <OpenInNew aria-hidden="true" className="size-3.5" />
          </a>
        ) : null}
        <Button asChild variant="secondary" size="sm">
          <NextLink href={designHref}>{tableAction(database.provisionedAt !== null)}</NextLink>
        </Button>
      </span>
    </li>
  );
}

/** The Docket-in-Notion hub. */
export function NotionMirrorPanel({ orgId, canManage }: NotionMirrorPanelProps): JSX.Element {
  const model = useNotionMirror(orgId);
  const people = useNotionPeople(orgId, model.integration?.id ?? '');
  const sync = useNotionMirrorSync(orgId, model.integration?.id ?? '');

  if (model.loading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {/* placeholder: the connection's own state and the databases designed against it, both
            of which only the server knows. */}
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  if (model.error !== null) {
    return <WriteError message={model.error} />;
  }

  if (model.integration === null) {
    return (
      <SettingsGroup>
        <EmptyState
          icon={LayoutTemplate}
          title="Notion isn’t connected yet"
          body="Connect a Notion workspace and Docket can build databases inside it for your work, and keep them current."
          frame="none"
          action={
            <Button asChild>
              <NextLink href={model.connectionsHref}>Connect Notion</NextLink>
            </Button>
          }
        />
      </SettingsGroup>
    );
  }

  const designHref = (entity: string): string =>
    `/orgs/${orgId}/settings/connections/notion/${entity}`;
  const needsPeople = people.unmatched.length > 0;
  const nothingProvisioned = model.provisionedCount === 0;
  const integrationId = model.integration.id;
  const containerPage = model.containerPage;
  const containerName = containerPage?.title ?? CONTAINER_UNKNOWN;
  const health = model.health;
  const connectionBroken = health.connection === 'error';
  // A mirror that failed while the credential still works. Suppressed when the connection itself
  // is broken, because then the alert above already says the true, more actionable thing.
  const mirrorBroken = !connectionBroken && health.lastRun === 'failed';
  const contentNeedsPermission = model.databases.some(
    (database) => database.content.state === 'inaccessible',
  );
  const contentTruncated = model.databases.some(
    (database) => database.content.state === 'truncated',
  );

  // Gated on the container page, not on `provisionedCount`: a provision that recorded the page and
  // then failed before creating anything has zero databases, and gating on those would leave the
  // one connection most in need of a re-run with no way to ask for one.
  // Gated on health too: a run against a rejected credential fails, which demotes the connection
  // again and notifies its owner. And on permission, because the route guards on `manage`.
  const canSync = containerPage !== null && !connectionBroken && canManage;
  const syncButton = canSync ? (
    <Button
      variant="outline"
      disabled={sync.syncing}
      onClick={() => {
        sync.sync();
      }}
    >
      {sync.syncing ? SYNC_ACTION_BUSY : SYNC_ACTION}
    </Button>
  ) : null;

  const tableList = (
    <ul>
      {model.databases.map((database) => (
        <DatabaseRow
          key={database.id}
          database={database}
          designHref={designHref(database.entityType)}
        />
      ))}
    </ul>
  );

  return (
    <div className="@container flex flex-col gap-5">
      {/* The chip reads the connection's real status. It used to be hardcoded green, so a
          connection the server had already demoted to `error` still rendered as "Connected" —
          the surface telling somebody their sync was fine while it was broken. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={
            connectionBroken
              ? 'bg-error-container text-on-error-container text-body-small inline-flex items-center gap-1.5 rounded-full px-2.5 py-1'
              : 'bg-tertiary-container text-on-tertiary-container text-body-small inline-flex items-center gap-1.5 rounded-full px-2.5 py-1'
          }
        >
          {connectionBroken ? (
            <CircleAlert aria-hidden="true" className="size-3.5" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="size-3.5" />
          )}
          {integrationStatusLabel(model.integration)}
        </span>
        <span className="text-on-surface-variant text-body-small">
          {model.integration.connection.externalWorkspaceName ??
            model.integration.connection.account ??
            'Notion workspace'}
        </span>
      </div>

      {connectionBroken ? (
        <CardAlert
          message={CONNECTION_ERROR_MESSAGE}
          detail={CONNECTION_ERROR_DETAIL}
          action={
            <NotionConnectAction label={RECONNECT_ACTION} variant="default" disabled={!canManage} />
          }
        />
      ) : null}

      {!connectionBroken && contentNeedsPermission ? (
        <CardAlert
          message={PAGE_CONTENT_PERMISSION_TITLE}
          detail={PAGE_CONTENT_PERMISSION_DETAIL}
          action={
            <NotionConnectAction label={RECONNECT_ACTION} variant="default" disabled={!canManage} />
          }
        />
      ) : contentTruncated ? (
        <CardNote tone="muted">
          {PAGE_CONTENT_TRUNCATED_TITLE} {PAGE_CONTENT_TRUNCATED_DETAIL}
        </CardNote>
      ) : null}

      {sync.error !== null ? (
        <CardNote tone="error">{sync.error}</CardNote>
      ) : mirrorBroken ? (
        <CardNote tone="error">
          {MIRROR_FAILED_TITLE} {syncFailureCopy(health.lastRunErrorKind)}
        </CardNote>
      ) : null}

      {/* The attention block renders only when there is something to act on, so a healthy
          connection is a quiet page rather than a wall of green reassurance. */}
      {needsPeople ? (
        <SettingsGroup>
          <p className="text-on-surface text-body-medium flex items-center gap-2">
            <CircleAlert aria-hidden="true" className="text-error size-4" />
            {people.unmatched.length === 1
              ? '1 person in Notion isn’t matched to anyone in Docket'
              : `${String(people.unmatched.length)} people in Notion aren’t matched to anyone in Docket`}
          </p>
          <p className="text-on-surface-variant text-body-small mt-1">
            Their assignments won’t reach Docket until they are.
          </p>
          <NextLink
            href={`/orgs/${orgId}/settings/connections/notion/people`}
            className="text-primary text-label-large mt-2 inline-block hover:underline"
          >
            Match people <ArrowRight aria-hidden="true" className="inline size-3.5" />
          </NextLink>
        </SettingsGroup>
      ) : null}

      {nothingProvisioned ? (
        <>
          {/* Provisioning creates the databases and then projects rows through the same token, so
              a run started here leaves empty tables behind in Notion. */}
          {connectionBroken ? (
            <p className="text-on-surface-variant text-body-small max-w-prose">{SETUP_BLOCKED}</p>
          ) : (
            <NotionSetupCard orgId={orgId} integrationId={integrationId} canManage={canManage} />
          )}
          {/* A page was already chosen but nothing exists in Notion — a provision that recorded
              its config and then failed. Retrying the run is the repair, and without this the
              connection is stranded on a setup card that only offers to pick a page again. */}
          {canSync ? <div className="flex justify-start">{syncButton}</div> : null}
          {/* A native disclosure rather than a controlled one: it holds no state worth owning,
              and `<details>` is keyboard- and screen-reader-complete without any of it. */}
          <details className="flex flex-col gap-2">
            <summary className="text-on-surface text-title-small cursor-pointer list-none marker:content-none">
              {previewSummary(model.databases.length)}
            </summary>
            <p className="text-on-surface-variant text-body-small mt-2 mb-2 max-w-prose">
              {EMPTY_DATABASE_HINT}
            </p>
            <SettingsGroup body="rows">{tableList}</SettingsGroup>
          </details>
        </>
      ) : (
        <SettingsGroup
          capability={SETTINGS_NODES.connectionsNotionDatabases}
          body="rows"
          footer={
            <div className="bg-surface-container flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              {/* The freshness stamp is what was last actually PUSHED, so it stays true even when
                  the newest run failed — but it is only reassuring on its own, which is why the
                  failure note above has to be read first. */}
              <p className="text-on-surface-variant text-body-small">
                {model.lastSyncedLabel !== null
                  ? `Last updated ${model.lastSyncedLabel}.`
                  : 'Nothing has been pushed to Notion yet.'}
              </p>
              {syncButton}
            </div>
          }
        >
          {containerPage !== null ? (
            <div className="flex flex-col gap-1 px-4 py-3">
              <span className="text-on-surface-variant text-body-small">{CONTAINER_LABEL}</span>
              {containerPage.url !== null ? (
                <a
                  href={containerPage.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary text-label-large inline-flex items-center gap-1 self-start hover:underline"
                >
                  {containerName}
                  <OpenInNew aria-hidden="true" className="size-3.5" />
                </a>
              ) : (
                <span className="text-on-surface text-label-large">{containerName}</span>
              )}
              <span className="text-on-surface-variant text-body-small">{CONTAINER_NOTE}</span>
            </div>
          ) : null}
          {tableList}
        </SettingsGroup>
      )}
    </div>
  );
}
