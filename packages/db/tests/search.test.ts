import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';

import {
  organization,
  searchDocument,
  searchDocumentFamily,
  searchDocumentKind,
  searchIndexJob,
  searchIndexJobOperation,
  searchIndexJobReason,
  searchIndexJobStatus,
} from '../src/schema';

describe('workspace search schema', () => {
  it('exports the semantic search enum values', () => {
    expect(searchDocumentFamily.enumValues).toEqual(['work', 'people', 'content', 'activity']);
    expect(searchDocumentKind.enumValues).toEqual(
      expect.arrayContaining(['task', 'comment', 'calendar_event', 'activity']),
    );
    expect(searchIndexJobOperation.enumValues).toEqual(['upsert', 'delete']);
    expect(searchIndexJobReason.enumValues).toEqual(
      expect.arrayContaining(['entity_write', 'event_log', 'backfill']),
    );
    expect(searchIndexJobStatus.enumValues).toEqual([
      'pending',
      'processing',
      'succeeded',
      'failed',
    ]);
  });

  it('persists semantic search documents and durable index jobs', async () => {
    const client = new PGlite('memory://');
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../drizzle') });

    try {
      const [org] = await db
        .insert(organization)
        .values({ name: 'Search Org', slug: 'search-org', lifecycleState: 'active' })
        .returning({ id: organization.id });
      if (!org) throw new Error('organization insert returned no row');

      await db.insert(searchDocument).values({
        id: `task:${org.id}:task_alpha`,
        organizationId: org.id,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'task_alpha',
        subjectKind: 'project',
        subjectId: 'project_alpha',
        sourceSystem: 'docket',
        externalUrl: null,
        title: 'Draft budget memo',
        summary: 'Needs review before the board packet closes.',
        body: 'Budget packet with revenue notes and stakeholder comments.',
        facet: { status: 'todo', priority: 'high' },
        route: {
          type: 'entity',
          organizationId: org.id,
          entityKind: 'task',
          entityId: 'task_alpha',
          href: `/orgs/${org.id}/my-work?taskId=task_alpha`,
        },
        visibility: { mode: 'org_members' },
        baseRank: 90,
        sourceUpdatedAt: new Date('2026-07-03T12:00:00.000Z'),
      });

      await expect(
        db.insert(searchDocument).values({
          id: `task:${org.id}:task_duplicate`,
          organizationId: org.id,
          kind: 'task',
          family: 'work',
          sourceTable: 'task',
          entityId: 'task_alpha',
          title: 'Duplicate source projection',
          facet: {},
          route: { type: 'entity', organizationId: org.id, entityKind: 'task', entityId: 'x' },
          visibility: { mode: 'org_members' },
        }),
      ).rejects.toThrow();

      await db.insert(searchIndexJob).values({
        id: 'job_search_task_alpha',
        organizationId: org.id,
        sourceTable: 'task',
        entityId: 'task_alpha',
        operation: 'upsert',
        reason: 'entity_write',
        dedupeKey: 'task:task_alpha:upsert:entity_write',
      });

      const [doc] = await db
        .select()
        .from(searchDocument)
        .where(eq(searchDocument.id, `task:${org.id}:task_alpha`))
        .limit(1);
      expect(doc).toMatchObject({
        kind: 'task',
        family: 'work',
        title: 'Draft budget memo',
        subjectKind: 'project',
        subjectId: 'project_alpha',
        baseRank: 90,
      });
      expect(doc?.facet).toMatchObject({ priority: 'high' });
      expect(doc?.route).toMatchObject({ type: 'entity', entityKind: 'task' });
      expect(doc?.visibility).toEqual({ mode: 'org_members' });

      const [job] = await db
        .select()
        .from(searchIndexJob)
        .where(eq(searchIndexJob.dedupeKey, 'task:task_alpha:upsert:entity_write'))
        .limit(1);
      expect(job).toMatchObject({
        status: 'pending',
        attempts: 0,
        operation: 'upsert',
        reason: 'entity_write',
      });
    } finally {
      await client.close();
    }
  });
});
