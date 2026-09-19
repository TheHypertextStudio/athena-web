'use client';

/**
 * `components/work-views/project-lens-frame` — what the Projects roster and the Project
 * dependencies page share.
 *
 * @remarks
 * Projects has two pages, the roster at `/orgs/[orgId]/projects` and the dependencies canvas at
 * `/orgs/[orgId]/projects/dependencies`. Authenticated navigation commits history directly and
 * mounts the destination from the route table, so no Next `layout.tsx` sits between them; the
 * frame they share is this module. It owns the vocabulary title, the two hrefs, and the lens
 * switch the canvas bar carries, so the pages agree on all three without either importing the
 * other.
 */
import { OrganizationId } from '@docket/identity-access/ids';
import { FolderKanban } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import DocketLink from '@/components/docket-link';
import { buildAuthenticatedHref } from '@/lib/authenticated-route';

/** The vocabulary the Projects pages use for the record they list. */
export const PROJECT_LENS_COPY = {
  title: 'Projects',
  singular: 'project',
  icon: FolderKanban,
} as const;

/** The roster's href for a workspace. */
export function projectRosterHref(orgId: string): string {
  return buildAuthenticatedHref('/orgs/[orgId]/projects', { orgId: OrganizationId.parse(orgId) });
}

/** The dependencies canvas's href for a workspace. */
export function projectDependenciesHref(orgId: string): string {
  return buildAuthenticatedHref('/orgs/[orgId]/projects/dependencies', {
    orgId: OrganizationId.parse(orgId),
  });
}

/** Props for {@link ProjectLensSwitch}. */
export interface ProjectLensSwitchProps {
  /** The workspace whose roster the List segment opens. */
  readonly orgId: string;
}

/**
 * The List and Dependencies segments in the canvas bar.
 *
 * @remarks
 * The dependencies page is the selected segment, and List is a link back to the roster, so the
 * switch is a real navigation rather than a state toggle.
 */
export function ProjectLensSwitch({ orgId }: ProjectLensSwitchProps): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={`${PROJECT_LENS_COPY.title} views`}
      className="bg-surface-container flex shrink-0 items-center gap-0.5 rounded-lg p-0.5"
    >
      <Button
        asChild
        role="tab"
        controlSize="sm"
        variant="ghost"
        className="shrink-0"
        aria-selected={false}
      >
        <DocketLink href={projectRosterHref(orgId)}>List</DocketLink>
      </Button>
      <Button
        role="tab"
        controlSize="sm"
        variant="secondary"
        className="shrink-0"
        aria-selected
        aria-current="page"
      >
        Dependencies
      </Button>
    </div>
  );
}
