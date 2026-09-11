/**
 * Open-documents store — shared types.
 *
 * @remarks
 * The multi-document tab bar tracks the caller's open "documents" — detail surfaces like a
 * task or a project. A {@link TabRef} is the minimal identity of one document (its kind, org,
 * and id); an {@link OpenTab} (from `@docket/ui/components`) adds the resolved title + href for
 * rendering. The store ({@link useOpenDocuments}) maps refs to open tabs, resolves titles
 * lazily, and persists the set across reloads.
 */
import { AgentSessionId, type AgentSessionId as AgentSessionIdValue } from '@docket/athena/ids';
import {
  CycleId,
  InitiativeId,
  ProgramId,
  ProjectId,
  TaskId,
  type CycleId as CycleIdValue,
  type InitiativeId as InitiativeIdValue,
  type ProgramId as ProgramIdValue,
  type ProjectId as ProjectIdValue,
  type TaskId as TaskIdValue,
} from '@docket/work/ids';
import {
  OrganizationId,
  type OrganizationId as OrganizationIdValue,
} from '@docket/identity-access/ids';
import type { OpenTab, TabDocType } from '@docket/ui/components';

import { buildAuthenticatedHref } from '@/lib/authenticated-route';

export type { OpenTab, TabDocType };

/** The minimal identity of an open document, with its kind correlated to its branded id. */
export type TabRef =
  | { readonly type: 'task'; readonly orgId: OrganizationIdValue; readonly id: TaskIdValue }
  | { readonly type: 'project'; readonly orgId: OrganizationIdValue; readonly id: ProjectIdValue }
  | { readonly type: 'program'; readonly orgId: OrganizationIdValue; readonly id: ProgramIdValue }
  | {
      readonly type: 'initiative';
      readonly orgId: OrganizationIdValue;
      readonly id: InitiativeIdValue;
    }
  | { readonly type: 'cycle'; readonly orgId: OrganizationIdValue; readonly id: CycleIdValue }
  | {
      readonly type: 'session';
      readonly orgId: OrganizationIdValue;
      readonly id: AgentSessionIdValue;
    };

/** Parse a persisted or legacy tab identity into its correlated branded descriptor. */
export function parseTabRef(type: TabDocType, orgId: string, id: string): TabRef {
  const organizationId = OrganizationId.parse(orgId);
  switch (type) {
    case 'task':
      return { type, orgId: organizationId, id: TaskId.parse(id) };
    case 'project':
      return { type, orgId: organizationId, id: ProjectId.parse(id) };
    case 'program':
      return { type, orgId: organizationId, id: ProgramId.parse(id) };
    case 'initiative':
      return { type, orgId: organizationId, id: InitiativeId.parse(id) };
    case 'cycle':
      return { type, orgId: organizationId, id: CycleId.parse(id) };
    case 'session':
      return { type, orgId: organizationId, id: AgentSessionId.parse(id) };
  }
}

/** The stable tab key for a document ref (`<type>:<orgId>:<id>`). */
export function tabKey(ref: TabRef): string {
  return `${ref.type}:${ref.orgId}:${ref.id}`;
}

/**
 * The route segment (under `/orgs/[orgId]/…`) that addresses each document kind.
 *
 * @remarks
 * Pluralized to match the real route tree (`/orgs/:orgId/tasks/:id`, `…/projects/:id`, …),
 * so {@link hrefForTab} and the route matcher stay in lockstep with the pages on disk.
 */
export const TAB_ROUTE_SEGMENT: Record<TabDocType, string> = {
  task: 'tasks',
  project: 'projects',
  initiative: 'initiatives',
  program: 'programs',
  cycle: 'cycles',
  session: 'sessions',
};

/** Build the detail-route href for a document ref. */
export function hrefForTab(ref: TabRef): string {
  switch (ref.type) {
    case 'task':
      return buildAuthenticatedHref('/orgs/[orgId]/tasks/[taskId]', {
        orgId: ref.orgId,
        taskId: ref.id,
      });
    case 'project':
      return buildAuthenticatedHref('/orgs/[orgId]/projects/[projectId]', {
        orgId: ref.orgId,
        projectId: ref.id,
      });
    case 'program':
      return buildAuthenticatedHref('/orgs/[orgId]/programs/[programId]', {
        orgId: ref.orgId,
        programId: ref.id,
      });
    case 'initiative':
      return buildAuthenticatedHref('/orgs/[orgId]/initiatives/[initiativeId]', {
        orgId: ref.orgId,
        initiativeId: ref.id,
      });
    case 'cycle':
      return buildAuthenticatedHref('/orgs/[orgId]/cycles/[cycleId]', {
        orgId: ref.orgId,
        cycleId: ref.id,
      });
    case 'session':
      return buildAuthenticatedHref('/orgs/[orgId]/sessions/[sessionId]', {
        orgId: ref.orgId,
        sessionId: ref.id,
      });
  }
}
