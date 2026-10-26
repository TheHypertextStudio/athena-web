import { assertDefined } from '@docket/test-utils';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connect, index, schema } from './library-fixtures';
import { seedMcpSurfaceOrg } from './mcp-surface-fixtures';
import { appWithActor } from '../support/routes-harness';
import { actionFor } from '../../src/search/query-results';

const Written = z.object({ resource: z.object({ id: z.string() }) });
const routers = {
  project: () => import('../../src/routes/projects'),
  program: () => import('../../src/routes/programs'),
  initiative: () => import('../../src/routes/initiatives'),
};

describe('files on work containers', () => {
  it.each(['project', 'program', 'initiative'] as const)(
    'offers a Library download and removes owned bytes when its %s is permanently deleted',
    async (subjectType) => {
      const s = await seedMcpSurfaceOrg(schema.db, schema, ['view', 'contribute', 'manage']);
      const subjectId = s[`${subjectType}Id`];
      const client = await connect(s.ctx);
      const result = await client.callTool({
        name: 'upload_resource',
        arguments: {
          orgId: s.orgId,
          subjectType,
          subjectId,
          requestId: 'container',
          fileName: 'brief.txt',
          contentBase64: Buffer.from('Brief').toString('base64'),
        },
      });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const id = Written.parse(result.structuredContent).resource.id;
      await index('attachment', id);
      const [document] = await schema.db
        .select()
        .from(schema.searchDocument)
        .where(eq(schema.searchDocument.entityId, id));
      expect(actionFor({ ...assertDefined(document), textRank: 0 })).toContainEqual({
        kind: 'download',
        label: 'Download',
        href: `/v1/orgs/${s.orgId}/work-resources/${subjectType}/${subjectId}/${id}/download`,
      });
      const [row] = await schema.db
        .select()
        .from(schema.attachment)
        .where(eq(schema.attachment.id, id));
      const blobKey = assertDefined(row?.blobKey);
      const router = (await routers[subjectType]()).default;
      const app = appWithActor(router, s.orgId, ['view', 'contribute', 'manage'], s.actorId);
      const removed = await app.request(`/${subjectId}`, { method: 'DELETE' });
      expect(removed.status, await removed.text()).toBe(200);
      const { processAttachmentBlobCleanup } =
        await import('../../src/content/deliverable-blob-cleanup');
      await processAttachmentBlobCleanup();
      expect(
        await schema.db.select().from(schema.attachment).where(eq(schema.attachment.id, id)),
      ).toHaveLength(0);
      const { getContainer } = await import('../../src/container');
      expect(await getContainer().blob.get(blobKey)).toBeNull();
      expect(
        await schema.db
          .select()
          .from(schema.resourceWriteReceipt)
          .where(eq(schema.resourceWriteReceipt.attachmentId, id)),
      ).toHaveLength(1);
    },
  );
});
