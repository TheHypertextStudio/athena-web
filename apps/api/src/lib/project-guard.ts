/**
 * `@docket/api` — the parent-Project guard shared by every router mounted under a Project.
 *
 * @remarks
 * Three routers now serve `/v1/orgs/:orgId/projects/:id/…` — attachments and the other project
 * resources, dependencies, and milestones — and each one has to answer the same question before it
 * touches anything: does this Project exist, in this org, unarchived? Written out per router the
 * `archivedAt` predicate is free to drift, and a milestone under an archived Project would stay
 * editable while its own list 404s.
 *
 * The failure is `Project not found` in every case, including "it belongs to another tenant": the
 * caller learns nothing about ids outside its org.
 */
import { db, project } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';

import { NotFoundError } from '../error';
import { one } from './one';

/**
 * Assert a Project is readable by the caller's org.
 *
 * @param organizationId - The caller's organization.
 * @param projectId - The Project id from the path.
 * @throws NotFoundError when the Project is absent, archived, or in another tenant.
 */
export async function assertProjectInOrg(organizationId: string, projectId: string): Promise<void> {
  const row = await one(
    db
      .select({ id: project.id })
      .from(project)
      .where(
        and(
          eq(project.organizationId, organizationId),
          eq(project.id, projectId),
          isNull(project.archivedAt),
        ),
      ),
  );
  if (!row) throw new NotFoundError('Project not found');
}
