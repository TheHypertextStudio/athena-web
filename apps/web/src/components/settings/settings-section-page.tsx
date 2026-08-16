'use client';

/**
 * `settings` — the shell every routed Settings section renders inside.
 *
 * @remarks
 * The page layer was the *consistent* layer right up until it wasn't: twenty-odd routes opened with
 * `flex flex-col gap-6` and a {@link SectionHeader}, and then each one privately decided the rest.
 * The audit found the wrapper gap split across `gap-4`/`6`/`8`/`10`, the content cap split across
 * `max-w-2xl`/`max-w-3xl`/none, header copy sometimes resolved from the registry and sometimes
 * retyped as a literal (the two Connections routes worded the same section differently), and
 * **fourteen** bespoke loading states — six skeleton geometries plus eight one-off sentences
 * ("Loading your profile…", "Loading connected apps…", …).
 *
 * None of those were decisions. They were the absence of a decision, repeated once per route. This
 * shell makes the wrapper, the cap, the header, and the pending state properties of *Settings*
 * rather than of whichever page you happen to be on, which is what stops them drifting again: a
 * route can no longer express them, so it can no longer disagree.
 *
 * @example
 * ```tsx
 * export default function ConnectionsSettingsPage(): JSX.Element {
 *   const orgId = usePersonalWorkspaceId();
 *   return (
 *     <SettingsSectionPage sectionKey="connections" loading={!orgId}>
 *       <ConnectionsPanel orgId={orgId ?? ''} />
 *     </SettingsSectionPage>
 *   );
 * }
 * ```
 */
import { Skeleton } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

import { SectionHeader } from './section-header';
import { SettingsBackLink } from './settings-back';
import { findSettingsSection } from './settings-registry';

/** The section a nested page sits under, and how to get back to it. */
export interface SettingsSectionParent {
  /** The parent section's name, as the nav spells it. */
  readonly label: string;
  /** The parent's absolute route. */
  readonly href: string;
}

/** Props for {@link SettingsSectionPage}. */
export interface SettingsSectionPageProps {
  /**
   * The section's registry key. Its label and description become the header, so the copy lives in
   * `settings-registry.ts` alongside the nav row that leads here.
   */
  readonly sectionKey?: string;
  /** Header title. Overrides the registry, and is required when `sectionKey` is omitted. */
  readonly title?: string;
  /** Header description. Overrides the registry. */
  readonly description?: string;
  /** A control aligned to the header's trailing edge. */
  readonly action?: ReactNode;
  /**
   * The section this page is nested under.
   *
   * @remarks
   * Five routes sit below a section rather than at one — the two Google Calendar pages, the Notion
   * hub, and Notion's People and per-entity pages — and each had answered "how do I get back?"
   * differently. Two answered it not at all. Three put a text link in `action`, which is the
   * trailing-edge slot that holds "New label" and "Add schedule" everywhere else, so the way out
   * of a page sat where its primary control lives. A fourth treatment appeared in the body of the
   * not-found branch.
   *
   * Declaring the parent instead of rendering a link means a nested page states a fact and Settings
   * decides how a way back looks — which is the only arrangement in which all five stay identical.
   */
  readonly parent?: SettingsSectionParent;
  /**
   * Whether the section's data is still resolving. Renders the shared skeleton in place of the
   * body, keeping the header — which needs no data — on screen throughout.
   */
  readonly loading?: boolean;
  /** The section body. */
  readonly children?: ReactNode;
}

/**
 * The wrapper, header, and pending state shared by every Settings section.
 *
 * @param props - The {@link SettingsSectionPageProps}.
 * @returns the rendered section page.
 */
export function SettingsSectionPage({
  sectionKey,
  title,
  description,
  action,
  parent,
  loading = false,
  children,
}: SettingsSectionPageProps): JSX.Element {
  const section = sectionKey ? findSettingsSection(sectionKey) : undefined;
  const resolvedTitle = title ?? section?.label ?? '';
  const resolvedDescription = description ?? section?.description ?? '';

  return (
    // `@container` is load-bearing, not decoration: `SectionHeader` and `SettingsGroup` both size
    // their headers with container queries, and a container query with no eligible ancestor never
    // evaluates true. Without this the whole settings tree was pinned to its stacked mobile layout
    // at every width — header actions under the title, preference grids stuck at one column.
    <div className="@container flex max-w-3xl flex-col gap-6">
      {/* The back link belongs to the header, not to the page's stack of sections, so it is
          grouped with it at `gap-2` rather than inheriting the wrapper's `gap-6`. */}
      <div className="flex flex-col gap-2">
        {/* Above the title, because that is where you look for where you came from — and because
            `action` means the section's own primary control everywhere else in Settings. */}
        {parent ? <SettingsBackLink href={parent.href} label={parent.label} /> : null}
        <SectionHeader title={resolvedTitle} description={resolvedDescription} action={action} />
      </div>
      {loading ? (
        // One pending shape for every section. The header is already painted, so this stands in
        // only for the body — two group-sized blocks, which is what most sections resolve into.
        <div className="flex flex-col gap-4" role="status" aria-label="Loading">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : (
        children
      )}
    </div>
  );
}
