import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { appWithActor } from '../support/routes-harness';
import { schema } from '../mcp/library-fixtures';
import { seedMcpSurfaceOrg } from '../mcp/mcp-surface-fixtures';
import { uploadRoutes } from '../../src/routes/uploads';
import type { AppEnv } from '../../src/context';

async function fixture() {
  const seed = await seedMcpSurfaceOrg(schema.db, schema, ['view', 'contribute', 'manage']);
  const [review] = await schema.db
    .insert(schema.demo)
    .values({
      name: 'Upload budget acceptance',
      slug: `upload-${seed.orgId.toLowerCase()}`,
      sourceOrganizationId: seed.orgId,
      mode: 'shared',
    })
    .returning();
  if (!review) throw new Error('Missing reviewer fixture');
  await schema.db
    .insert(schema.demoWorkspace)
    .values({ demoId: review.id, organizationId: seed.orgId });
  const app = appWithActor(
    new Hono<AppEnv>().route('/uploads', uploadRoutes),
    seed.orgId,
    ['manage'],
    seed.actorId,
  );
  const reserve = (requestId: string, byteSize: number) =>
    app.request('/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        byteSize,
        fileName: 'report.txt',
        mimeType: 'text/plain',
        crc32c: '4waSgw==',
        destination: { kind: 'draft' },
      }),
    });
  return { ...seed, demoId: review.id, reserve, app };
}

describe('reviewer direct-upload byte admission', () => {
  it('rejects a large declaration before reserving a provider capability', async () => {
    const f = await fixture();
    expect((await f.reserve('oversized', 21 * 1024 * 1024)).status).toBe(429);
    expect(
      await schema.db
        .select()
        .from(schema.fileUpload)
        .where(eq(schema.fileUpload.organizationId, f.orgId)),
    ).toEqual([]);
    expect(
      await schema.db
        .select()
        .from(schema.demoBudget)
        .where(eq(schema.demoBudget.demoId, f.demoId)),
    ).toEqual([]);
  });

  it('charges one reservation once across retries and rejects subsequent excess atomically', async () => {
    const f = await fixture();
    const [first, retried] = await Promise.all([f.reserve('stable', 9), f.reserve('stable', 9)]);
    expect(first.status).toBe(200);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual(await first.json());
    const counters = await schema.db
      .select()
      .from(schema.demoBudget)
      .where(eq(schema.demoBudget.demoId, f.demoId));
    expect(counters).toHaveLength(1);
    expect(counters[0]?.count).toBe(9);
    expect((await f.reserve('next', 20 * 1024 * 1024)).status).toBe(429);
    expect(
      (
        await schema.db
          .select()
          .from(schema.demoBudget)
          .where(eq(schema.demoBudget.demoId, f.demoId))
      )[0]?.count,
    ).toBe(9);
    const rows = await schema.db
      .select()
      .from(schema.fileUpload)
      .where(eq(schema.fileUpload.organizationId, f.orgId));
    expect(rows).toHaveLength(1);
    if (rows[0])
      expect((await f.app.request(`/uploads/${rows[0].id}`, { method: 'DELETE' })).status).toBe(
        200,
      );
  });
});
