/**
 * `@docket/api` — composing a published brief out of the live work tables.
 *
 * @remarks
 * This module is the answer to "does a brief read the same data as the app?". It holds the
 * only query path a public visitor's request ever takes, and every read in it targets the same
 * `initiative` / `program` / `project` / `task` / `milestone` rows the authenticated detail
 * pages read — the same tables, the same columns, no publication-time copy anywhere. Publishing
 * writes one row (`publication`) recording *that* a record is public and *where*; it never
 * writes what the record says.
 *
 * That is a structural guarantee, not a discipline: `@docket/db`'s `publication` table has no
 * title, no description, no status, and no child list, so a stale brief is not expressible.
 *
 * Reachability is resolved here too, because it is part of the same read:
 * - the visitor's `Host` decides *which* workspaces may be served (a verified custom domain
 *   serves exactly one workspace; the product's own brief host serves any workspace), and
 * - on the shared brief host, the workspace's own identity slug plus the brief's slug identify
 *   the record; on a verified custom domain, the host alone already identifies the workspace, so
 *   only the brief's slug is needed.
 *
 * Nothing in here renders a sentence. It returns raw enum members, ISO timestamps, and names;
 * the web app owns every word a reader sees.
 */
import {
  actor,
  db,
  initiative,
  initiativeProgram,
  initiativeProject,
  milestone,
  organization,
  program,
  project,
  publication,
  task,
  team,
  workspaceDomain,
} from '@docket/db';
import { apiHosts, isOwnHost } from '@docket/env/api';
import { normalizeCustomDomain } from '@docket/env/custom-domain';
import type {
  BriefFact,
  BriefSection,
  BriefWorkItem,
  PublicBriefOut,
  PublicationSubjectKind,
} from '@docket/work/publish-contract';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { env } from '../env';
import { NotFoundError } from '../error';

/**
 * How many rows one brief section lists before it reports a remainder instead.
 *
 * @remarks
 * A brief is a document someone prints. A project with 900 tasks does not become more useful as
 * a 40-page appendix, and rendering it would make the page unusable on paper and slow on a
 * phone. The section still reports its true `total`, so the document says "showing 50 of 900"
 * rather than silently pretending 50 is all there is.
 */
export const BRIEF_SECTION_LIMIT = 50;

/**
 * A date column rendered as the bare calendar day it means.
 *
 * @remarks
 * A start or target date is a *day*, not an instant — the column is a `timestamp` only because
 * that is what the schema uses. Emitting the full ISO instant makes every reader west of UTC
 * render the day before (`2026-07-01T00:00:00Z` formats as "Jun 30" in the Americas), which on a
 * printed brief is a wrong deadline rather than a cosmetic slip. Emitting `YYYY-MM-DD` is what
 * the task serializer already does, and it is the form the web's `formatCalendarDate` reads as a
 * timezone-stable day.
 *
 * @param value - The stored timestamp, or `null`.
 * @returns The bare calendar day, or `null`.
 */
function calendarDay(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

/** What a public request asked for, before any of it has been resolved. */
export interface BriefLocator {
  /** The `Host` the visitor's browser asked on, when the caller could determine it. */
  readonly host: string | undefined;
  /**
   * The workspace's own identity slug, present for a request on the shared brief host. `undefined`
   * for a request on a workspace's own verified custom domain, where the host alone already
   * identifies exactly one workspace and a path segment for it would be redundant.
   */
  readonly workspaceSlug: string | undefined;
  /** The brief's path segment within that workspace. */
  readonly slug: string;
}

/**
 * Whether a host is one of Docket's own, as opposed to a workspace's custom domain.
 *
 * @remarks
 * Docket's own hosts serve every workspace; a custom domain serves exactly one workspace. Getting
 * this backwards in either direction is a tenancy bug, so the decision is made once, here, from
 * the resolved host contract rather than from string heuristics.
 *
 * The `.localhost` allowance is gated on the app mode, not merely conventional: outside
 * production the brief host, the app host, and the API host are all portless `*.localhost`
 * names that no host contract enumerates, and without it no local or CI request could reach a
 * brief at all. In production the branch is dead.
 *
 * @param host - A bare hostname, already lowercased and port-stripped.
 * @returns `true` when the host belongs to Docket rather than to a workspace.
 */
export function isProductHost(host: string): boolean {
  if (isOwnHost(host)) return true;
  if (env.APP_MODE === 'production') return false;
  return host === 'localhost' || host.endsWith('.localhost');
}

/**
 * Which workspace, if any, a request's `Host` restricts the response to.
 *
 * @remarks
 * Returns `undefined` for one of Docket's own hosts (no restriction) and a workspace id for a
 * verified custom domain. Throws for anything else: an unknown host, or a host whose domain row
 * exists but has not proved ownership. Both are refusals under the rule that a domain must pass
 * DNS verification before it may serve published content, and both are 404 rather than 403 —
 * telling an anonymous visitor "this domain is registered here but unverified" would confirm the
 * existence of a claim they have no business knowing about.
 *
 * @param host - The `Host` the visitor asked on, or `undefined` when unknown.
 * @returns The workspace the host restricts to, or `undefined` for no restriction.
 * @throws {NotFoundError} When the host neither belongs to Docket nor is a verified domain.
 */
export async function resolveHostScope(host: string | undefined): Promise<string | undefined> {
  if (host === undefined || host.length === 0) return undefined;
  const normalized = normalizeCustomDomain(host);
  const bare = normalized.ok ? normalized.host : host.split(':')[0]?.toLowerCase();
  if (bare === undefined) throw new NotFoundError('Brief not found');
  if (isProductHost(bare)) return undefined;

  const rows = await db
    .select({ organizationId: workspaceDomain.organizationId })
    .from(workspaceDomain)
    .where(and(eq(workspaceDomain.host, bare), isNotNull(workspaceDomain.verifiedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Brief not found');
  return row.organizationId;
}

/** A published record's identity, after the locator has been resolved against the database. */
interface ResolvedPublication {
  readonly organizationId: string;
  readonly subjectKind: PublicationSubjectKind;
  readonly subjectId: string;
  readonly slug: string;
  readonly workspaceSlug: string;
  readonly publishedAt: Date;
}

/**
 * Resolve which workspace a locator addresses, before its brief slug is looked up.
 *
 * @remarks
 * Two distinct shapes, matching {@link BriefLocator.workspaceSlug}'s two states:
 * - **Shared host** (`workspaceSlug` present): the workspace is found by its own identity slug.
 *   A verified-custom-domain `hostScope` still gates it — a brief belonging to a different
 *   workspace must not be reachable on this host — reachable only via a stale link or a direct
 *   API call today, since the proxy rewrite never produces this shape for a custom domain.
 * - **Custom domain** (`workspaceSlug` absent): the host itself is the only identifier. No
 *   `hostScope` means no verified domain matched at all, which is a refusal, not an "any
 *   workspace" fallback — the shared host never reaches this branch.
 *
 * @throws {NotFoundError} When no workspace matches.
 */
async function resolveWorkspace(
  locator: Pick<BriefLocator, 'host' | 'workspaceSlug'>,
): Promise<{ id: string; slug: string }> {
  const hostScope = await resolveHostScope(locator.host);

  if (locator.workspaceSlug !== undefined) {
    const rows = await db
      .select({ id: organization.id, slug: organization.slug })
      .from(organization)
      .where(eq(organization.slug, locator.workspaceSlug))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Brief not found');
    if (hostScope !== undefined && hostScope !== row.id) throw new NotFoundError('Brief not found');
    return row;
  }

  if (hostScope === undefined) throw new NotFoundError('Brief not found');
  const rows = await db
    .select({ id: organization.id, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, hostScope))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Brief not found');
  return row;
}

/**
 * Resolve a locator to exactly one currently-published record, or refuse.
 *
 * @param locator - The host, workspace slug (shared host) or nothing (custom domain), and brief
 *   slug from the request.
 * @returns The publication's identity.
 * @throws {NotFoundError} When nothing published matches, including every refusal case.
 */
async function resolvePublication(locator: BriefLocator): Promise<ResolvedPublication> {
  const workspace = await resolveWorkspace(locator);

  const rows = await db
    .select()
    .from(publication)
    .where(
      and(
        eq(publication.organizationId, workspace.id),
        eq(publication.slug, locator.slug),
        isNotNull(publication.publishedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row?.publishedAt) throw new NotFoundError('Brief not found');

  return {
    organizationId: row.organizationId,
    subjectKind: row.subjectKind,
    subjectId: row.subjectId,
    slug: row.slug,
    workspaceSlug: workspace.slug,
    publishedAt: row.publishedAt,
  };
}

/** Resolve an owning actor id to a display name, or `null` when unset or deleted. */
async function ownerName(organizationId: string, ownerId: string | null): Promise<string | null> {
  if (ownerId === null) return null;
  const rows = await db
    .select({ displayName: actor.displayName })
    .from(actor)
    .where(and(eq(actor.id, ownerId), eq(actor.organizationId, organizationId)))
    .limit(1);
  return rows[0]?.displayName ?? null;
}

/** Build one section from rows plus the true total, so a capped section can say so. */
function section(
  key: BriefSection['key'],
  items: readonly z.input<typeof BriefWorkItem>[],
  total: number,
): z.input<typeof BriefSection> {
  return { key, items: [...items], total };
}

/** Project a `project` row into a brief line. */
function projectItem(row: typeof project.$inferSelect): z.input<typeof BriefWorkItem> {
  return {
    id: row.id,
    kind: 'project',
    title: row.name,
    status: row.status,
    health: row.health,
    startDate: calendarDay(row.startDate),
    targetDate: calendarDay(row.targetDate),
    complete: row.status === 'completed',
  };
}

/** Project a `program` row into a brief line. */
function programItem(row: typeof program.$inferSelect): z.input<typeof BriefWorkItem> {
  return {
    id: row.id,
    kind: 'program',
    title: row.name,
    status: row.status,
    health: row.health,
    startDate: null,
    targetDate: null,
    complete: false,
  };
}

/**
 * Load a record's tasks as brief lines, resolving each task's per-team workflow state.
 *
 * @remarks
 * `task.state` is a per-team key with no global foreign key, so "is this done?" is only
 * answerable by reading the owning team's `workflow_states` — exactly what the in-app board
 * does. Falling back to `completedAt`/`canceledAt` when a key is missing from its team's
 * workflow keeps a brief honest about a task whose state was renamed out from under it.
 *
 * @param organizationId - The owning workspace.
 * @param where - The already-built predicate selecting the record's tasks.
 * @returns The capped rows plus the true total.
 */
async function taskSection(
  organizationId: string,
  taskIdColumn: typeof task.projectId | typeof task.programId,
  parentId: string,
): Promise<z.input<typeof BriefSection>> {
  const rows = await db
    .select({ t: task, workflowStates: team.workflowStates })
    .from(task)
    .innerJoin(team, eq(task.teamId, team.id))
    .where(and(eq(task.organizationId, organizationId), eq(taskIdColumn, parentId)))
    .orderBy(asc(task.dueDate), asc(task.createdAt));

  const items = rows.slice(0, BRIEF_SECTION_LIMIT).map(({ t, workflowStates }) => {
    const state = workflowStates.find((candidate) => candidate.key === t.state);
    const complete =
      state !== undefined
        ? state.type === 'completed' || state.type === 'canceled'
        : t.completedAt !== null || t.canceledAt !== null;
    return {
      id: t.id,
      kind: 'task' as const,
      title: t.title,
      status: state?.name ?? t.state,
      health: null,
      startDate: calendarDay(t.startDate),
      targetDate: calendarDay(t.dueDate),
      complete,
    };
  });
  return section('tasks', items, rows.length);
}

/** The brief body for a published initiative: its programs, its projects, and its dates. */
async function initiativeBrief(
  resolved: ResolvedPublication,
): Promise<
  Pick<
    z.input<typeof PublicBriefOut>,
    'title' | 'summary' | 'description' | 'facts' | 'sections' | 'updatedAt'
  >
> {
  const rows = await db
    .select()
    .from(initiative)
    .where(
      and(
        eq(initiative.id, resolved.subjectId),
        eq(initiative.organizationId, resolved.organizationId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Brief not found');

  const [projects, programs, owner] = await Promise.all([
    db
      .select({ p: project })
      .from(initiativeProject)
      .innerJoin(project, eq(initiativeProject.projectId, project.id))
      .where(
        and(
          eq(initiativeProject.initiativeId, row.id),
          eq(initiativeProject.organizationId, resolved.organizationId),
          isNull(project.archivedAt),
        ),
      )
      .orderBy(asc(project.targetDate), asc(project.name)),
    db
      .select({ p: program })
      .from(initiativeProgram)
      .innerJoin(program, eq(initiativeProgram.programId, program.id))
      .where(
        and(
          eq(initiativeProgram.initiativeId, row.id),
          eq(initiativeProgram.organizationId, resolved.organizationId),
        ),
      )
      .orderBy(asc(program.name)),
    ownerName(resolved.organizationId, row.ownerId),
  ]);

  const facts: z.input<typeof BriefFact>[] = [
    { key: 'status', value: row.status },
    { key: 'health', value: row.health },
    { key: 'priority', value: row.priority },
    { key: 'owner', value: owner },
    { key: 'targetDate', value: calendarDay(row.targetDate) },
  ];

  return {
    title: row.name,
    summary: row.summary,
    description: row.description,
    facts,
    sections: [
      section(
        'programs',
        programs.slice(0, BRIEF_SECTION_LIMIT).map(({ p }) => programItem(p)),
        programs.length,
      ),
      section(
        'projects',
        projects.slice(0, BRIEF_SECTION_LIMIT).map(({ p }) => projectItem(p)),
        projects.length,
      ),
    ],
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The brief body for a published program: its projects and its directly-held tasks. */
async function programBrief(
  resolved: ResolvedPublication,
): Promise<
  Pick<
    z.input<typeof PublicBriefOut>,
    'title' | 'summary' | 'description' | 'facts' | 'sections' | 'updatedAt'
  >
> {
  const rows = await db
    .select()
    .from(program)
    .where(
      and(eq(program.id, resolved.subjectId), eq(program.organizationId, resolved.organizationId)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Brief not found');

  const [projects, owner, tasks] = await Promise.all([
    db
      .select()
      .from(project)
      .where(
        and(
          eq(project.organizationId, resolved.organizationId),
          eq(project.programId, row.id),
          isNull(project.archivedAt),
        ),
      )
      .orderBy(asc(project.targetDate), asc(project.name)),
    ownerName(resolved.organizationId, row.ownerId),
    taskSection(resolved.organizationId, task.programId, row.id),
  ]);

  const facts: z.input<typeof BriefFact>[] = [
    { key: 'status', value: row.status },
    { key: 'health', value: row.health },
    { key: 'owner', value: owner },
  ];

  return {
    title: row.name,
    summary: row.summary,
    description: row.description,
    facts,
    sections: [
      section('projects', projects.slice(0, BRIEF_SECTION_LIMIT).map(projectItem), projects.length),
      tasks,
    ],
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The brief body for a published project: its milestones and its tasks. */
async function projectBrief(
  resolved: ResolvedPublication,
): Promise<
  Pick<
    z.input<typeof PublicBriefOut>,
    'title' | 'summary' | 'description' | 'facts' | 'sections' | 'updatedAt'
  >
> {
  const rows = await db
    .select()
    .from(project)
    .where(
      and(
        eq(project.id, resolved.subjectId),
        eq(project.organizationId, resolved.organizationId),
        isNull(project.archivedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Brief not found');

  const [milestones, lead, tasks] = await Promise.all([
    db
      .select()
      .from(milestone)
      .where(
        and(eq(milestone.organizationId, resolved.organizationId), eq(milestone.projectId, row.id)),
      )
      .orderBy(asc(milestone.sort), asc(milestone.targetDate)),
    ownerName(resolved.organizationId, row.leadId),
    taskSection(resolved.organizationId, task.projectId, row.id),
  ]);

  const facts: z.input<typeof BriefFact>[] = [
    { key: 'status', value: row.status },
    { key: 'health', value: row.health },
    { key: 'owner', value: lead },
    { key: 'startDate', value: calendarDay(row.startDate) },
    { key: 'targetDate', value: calendarDay(row.targetDate) },
  ];

  return {
    title: row.name,
    summary: row.summary,
    description: row.description,
    facts,
    sections: [
      section(
        'milestones',
        milestones.slice(0, BRIEF_SECTION_LIMIT).map((m) => ({
          id: m.id,
          kind: 'milestone' as const,
          title: m.name,
          status: null,
          health: null,
          startDate: null,
          targetDate: calendarDay(m.targetDate),
          complete: false,
        })),
        milestones.length,
      ),
      tasks,
    ],
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Load one published brief, live, for an anonymous visitor.
 *
 * @remarks
 * The single entry point the public route uses. Every refusal — unknown host, unverified
 * domain, wrong workspace for the host, unknown workspace name, unknown slug, withdrawn brief,
 * deleted record — surfaces as the same {@link NotFoundError}, so a visitor cannot probe for
 * the existence of anything they may not read.
 *
 * @param locator - The host, workspace name, and brief slug from the request.
 * @returns The brief document.
 * @throws {NotFoundError} For every refusal case.
 *
 * @example
 * ```ts
 * // Shared brief host — a workspace slug identifies the workspace.
 * await loadPublicBrief({ host: 'briefs.docket.place', workspaceSlug: 'acme', slug: 'q3' });
 * // A verified custom domain — the host alone identifies the workspace.
 * await loadPublicBrief({ host: 'updates.acme.com', workspaceSlug: undefined, slug: 'q3' });
 * ```
 */
export async function loadPublicBrief(
  locator: BriefLocator,
): Promise<z.input<typeof PublicBriefOut>> {
  const resolved = await resolvePublication(locator);

  const orgs = await db
    .select({ name: organization.name, vocabulary: organization.vocabulary })
    .from(organization)
    .where(eq(organization.id, resolved.organizationId))
    .limit(1);
  const org = orgs[0];
  if (!org) throw new NotFoundError('Brief not found');

  const body =
    resolved.subjectKind === 'initiative'
      ? await initiativeBrief(resolved)
      : resolved.subjectKind === 'program'
        ? await programBrief(resolved)
        : await projectBrief(resolved);

  return {
    subjectKind: resolved.subjectKind,
    subjectId: resolved.subjectId,
    slug: resolved.slug,
    workspaceSlug: resolved.workspaceSlug,
    workspaceName: org.name,
    vocabulary: org.vocabulary,
    ...body,
    publishedAt: resolved.publishedAt.toISOString(),
    canonicalUrl: briefUrlOnBriefHost(resolved.workspaceSlug, resolved.slug),
  };
}

/** The path a brief answers on via the shared brief host, where many workspaces coexist. */
export function briefPath(workspaceSlug: string, slug: string): string {
  return `/${workspaceSlug}/${slug}`;
}

/**
 * The path a brief answers on via a workspace's own verified custom domain.
 *
 * @remarks
 * No workspace segment: the domain itself already belongs to exactly one workspace (a domain can
 * be claimed by only one, per the unique host index), so `/<workspaceSlug>/<slug>` there would be
 * redundant — `updates.acme.com/q3-roadmap`, not `updates.acme.com/acme-corp/q3-roadmap`.
 */
export function customDomainBriefPath(slug: string): string {
  return `/${slug}`;
}

/**
 * The brief's absolute URL on Docket's own brief host, when one is configured.
 *
 * @remarks
 * `null` rather than a guessed origin: a deployment with no brief host configured genuinely has
 * no shared public address, and inventing one would put a dead link in a printed document.
 *
 * @param workspaceSlug - The publishing workspace's own identity slug.
 * @param slug - The brief's path segment.
 * @returns The absolute URL, or `null` when no brief host is configured.
 */
export function briefUrlOnBriefHost(workspaceSlug: string, slug: string): string | null {
  const briefHost = apiHosts.brief;
  if (briefHost === undefined) return null;
  return `https://${briefHost}${briefPath(workspaceSlug, slug)}`;
}

/**
 * Every absolute URL a workspace's brief is currently reachable at.
 *
 * @remarks
 * Shown in the app after publishing, so the person sees exactly what they can share. Empty only
 * when this deployment has no brief host configured AND the workspace has no verified custom
 * domain — every workspace has its own identity slug from the moment it exists, so there is no
 * "not addressed yet" state to report anymore.
 *
 * @param organizationId - The publishing workspace.
 * @param slug - The brief's path segment.
 * @returns Absolute URLs, brief host first.
 */
export async function briefUrls(organizationId: string, slug: string): Promise<string[]> {
  const [orgs, domains] = await Promise.all([
    db
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1),
    db
      .select({ host: workspaceDomain.host })
      .from(workspaceDomain)
      .where(
        and(
          eq(workspaceDomain.organizationId, organizationId),
          isNotNull(workspaceDomain.verifiedAt),
        ),
      )
      .orderBy(asc(workspaceDomain.host)),
  ]);

  const workspaceSlug = orgs[0]?.slug;
  /* v8 ignore next -- @preserve defensive: organizationId is always a real org's id */
  if (workspaceSlug === undefined) return [];

  const urls: string[] = [];
  const canonical = briefUrlOnBriefHost(workspaceSlug, slug);
  if (canonical !== null) urls.push(canonical);
  for (const domain of domains) {
    urls.push(`https://${domain.host}${customDomainBriefPath(slug)}`);
  }
  return urls;
}

/**
 * Confirm a record exists in the workspace and return its title.
 *
 * @remarks
 * Used by the publish handler both to refuse a cross-tenant subject id and to derive a default
 * slug from the record's own name. Reads the same rows the brief will later read.
 *
 * @param organizationId - The workspace the caller is acting in.
 * @param kind - Which work table to look in.
 * @param subjectId - The record id.
 * @returns The record's title.
 * @throws {NotFoundError} When the record does not exist in that workspace.
 */
export async function requireSubjectTitle(
  organizationId: string,
  kind: PublicationSubjectKind,
  subjectId: string,
): Promise<string> {
  const table = kind === 'initiative' ? initiative : kind === 'program' ? program : project;
  const rows = await db
    .select({ name: table.name })
    .from(table)
    .where(and(eq(table.id, subjectId), eq(table.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Record not found');
  return row.name;
}

/** Load the publication rows for a set of subject ids, for the app's publish affordance. */
export async function publicationsForSubjects(
  organizationId: string,
  kind: PublicationSubjectKind,
  subjectIds: readonly string[],
): Promise<(typeof publication.$inferSelect)[]> {
  if (subjectIds.length === 0) return [];
  return db
    .select()
    .from(publication)
    .where(
      and(
        eq(publication.organizationId, organizationId),
        eq(publication.subjectKind, kind),
        inArray(publication.subjectId, [...subjectIds]),
      ),
    )
    .orderBy(desc(publication.createdAt));
}
