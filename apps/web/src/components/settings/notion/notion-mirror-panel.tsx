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
 * Pure presentation — all reads and writes live in `use-notion-mirror-controller.ts`.
 */
import type { NotionMirrorDatabaseOut } from '@docket/types';
import { cn } from '@docket/ui';
import { ArrowRight, CheckCircle2, CircleAlert } from '@docket/ui/icons';
import { Skeleton } from '@docket/ui/primitives';
import NextLink from 'next/link';
import type { JSX } from 'react';

import { EMPTY_DATABASE_HINT, entityLabel } from './notion-copy';
import { NotionSetupCard } from './notion-setup-card';
import { useNotionMirror, useNotionPeople } from './use-notion-mirror-controller';

/** Props for {@link NotionMirrorPanel}. */
export interface NotionMirrorPanelProps {
  /** The active workspace. */
  orgId: string;
}

/** One database row in the hub list. */
function DatabaseRow({
  database,
  designHref,
}: {
  database: NotionMirrorDatabaseOut;
  designHref: string;
}): JSX.Element {
  const provisioned = database.provisionedAt !== null;
  // Only worth showing once the user has renamed the database. Until then it repeats the title
  // straight back ("Tasks … Tasks"), which is noise standing where information should be.
  const renamed = database.title !== entityLabel(database.entityType);
  return (
    <li className="border-outline-variant flex items-center gap-3 border-b px-4 py-2 last:border-b-0">
      <NextLink
        href={designHref}
        className="text-on-surface text-label-large min-w-0 flex-1 truncate hover:underline"
      >
        {database.title}
      </NextLink>
      {renamed ? (
        <span className="text-on-surface-variant text-body-small hidden @md:inline">
          {entityLabel(database.entityType)}
        </span>
      ) : null}
      <span className="text-on-surface-variant text-body-small w-16 text-right tabular-nums">
        {provisioned ? database.rowCount.toLocaleString() : '—'}
      </span>
      <span
        className={cn(
          'text-body-small shrink-0 rounded-full px-2 py-0.5 text-center whitespace-nowrap',
          database.direction === 'two_way'
            ? 'bg-primary/10 text-primary'
            : 'text-on-surface-variant',
        )}
      >
        {database.direction === 'two_way' ? 'Two-way' : 'From Docket'}
      </span>
    </li>
  );
}

/** The Docket-in-Notion hub. */
export function NotionMirrorPanel({ orgId }: NotionMirrorPanelProps): JSX.Element {
  const model = useNotionMirror(orgId);
  const people = useNotionPeople(orgId, model.integration?.id ?? '');

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
    return (
      <p role="alert" className="text-error text-body-medium">
        {model.error}
      </p>
    );
  }

  if (model.integration === null) {
    return (
      <div className="border-outline-variant flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
        <p className="text-on-surface text-label-large">Notion isn’t connected yet</p>
        <p className="text-on-surface-variant text-body-small max-w-prose">
          Once you connect a Notion workspace, Docket can build databases inside it for your tasks,
          projects and the rest of your work — and keep them current.
        </p>
        <NextLink
          href={model.connectionsHref}
          className="text-primary text-label-large hover:underline"
        >
          Connect Notion <ArrowRight aria-hidden="true" className="inline size-3.5" />
        </NextLink>
      </div>
    );
  }

  const designHref = (entity: string): string =>
    `/orgs/${orgId}/settings/connections/notion/${entity}`;
  const needsPeople = people.unmatched.length > 0;
  const nothingProvisioned = model.provisionedCount === 0;

  return (
    <div className="@container flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="bg-tertiary-container text-on-tertiary-container text-body-small inline-flex items-center gap-1.5 rounded-full px-2.5 py-1">
          <CheckCircle2 aria-hidden="true" className="size-3.5" />
          Connected
        </span>
        <span className="text-on-surface-variant text-body-small">
          {model.integration.connection.externalWorkspaceName ??
            model.integration.connection.account ??
            'Notion workspace'}
        </span>
      </div>

      {/* The attention block renders only when there is something to act on, so a healthy
          connection is a quiet page rather than a wall of green reassurance. */}
      {needsPeople ? (
        <div className="border-outline-variant bg-surface-container rounded-xl border p-4">
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
        </div>
      ) : null}

      <section className="flex flex-col gap-2" aria-label="Docket in Notion">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-on-surface text-title-small">Docket in Notion</h2>
          <span className="text-on-surface-variant text-body-small tabular-nums">
            {nothingProvisioned
              ? 'Not created yet'
              : `${model.totalRows.toLocaleString()} rows in ${String(model.provisionedCount)} databases`}
          </span>
        </div>
        <p className="text-on-surface-variant text-body-small max-w-prose">
          {nothingProvisioned ? EMPTY_DATABASE_HINT : 'Docket keeps these current.'}
        </p>
        {nothingProvisioned ? (
          <NotionSetupCard orgId={orgId} integrationId={model.integration.id} />
        ) : null}
        <ul className="border-outline-variant bg-surface-container-low mt-1 overflow-hidden rounded-xl border">
          {model.databases.map((database) => (
            <DatabaseRow
              key={database.id}
              database={database}
              designHref={designHref(database.entityType)}
            />
          ))}
        </ul>
        <p className="text-on-surface-variant text-body-small mt-1">
          Rows Docket owns are read-only in Notion. Edits to two-way fields flow back.
          {model.lastSyncedLabel !== null ? ` Last synced ${model.lastSyncedLabel}.` : ''}
        </p>
      </section>
    </div>
  );
}
