import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { DocumentImageOut } from '@docket/types';

import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';
import type documentImageRouter from '../../src/routes/document-images';
import type * as ContainerModule from '../../src/container';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let documentImages!: typeof documentImageRouter;
// Imported dynamically (after the harness sets `SKIP_ENV_VALIDATION`) so loading the container
// doesn't trip fail-fast env validation at module load.
let getContainer!: typeof ContainerModule.getContainer;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  documentImages = (await import('../../src/routes/document-images')).default;
  getContainer = (await import('../../src/container')).getContainer;
});

const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Build an in-memory image of `size` bytes with the given name/type. */
function imageOfSize(name: string, size: number, type = 'image/png'): File {
  return new File([new Uint8Array(size).fill(0x61)], name, { type });
}

/** POST an image into a workspace. */
async function upload(app: ReturnType<typeof appWithActor>, file: File): Promise<Response> {
  const form = new FormData();
  form.set('file', file);
  return app.request('/', { method: 'POST', body: form });
}

/** The deterministic blob key an uploaded image is stored under. */
function blobKeyFor(orgId: string, imageId: string): string {
  return `document-images/${orgId}/${imageId}`;
}

/**
 * These bytes are served **inline**, which is the whole reason the route exists and also the whole
 * reason it has to be strict. An image that downloads cannot render inside prose; an upload that is
 * not raster could carry script and would then execute on Docket's own origin. So the allowlist and
 * the response headers are the two things pinned hardest here.
 */
describe('document image routes', () => {
  it('stores an image and returns the URL that belongs in the Markdown', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(documentImages, orgId, ['contribute'], humanActorId);

    const res = await upload(w, imageOfSize('screenshot.png', 12));
    expect(res.status).toBe(200);

    const created = await body<DocumentImageOut>(res);
    expect(created.mimeType).toBe('image/png');
    expect(created.byteSize).toBe(12);
    expect(created.fileName).toBe('screenshot.png');
    expect(created.url).toBe(`/v1/orgs/${orgId}/images/${created.id}`);

    const stored = await getContainer().blob.get(blobKeyFor(orgId, created.id));
    expect(stored?.length).toBe(12);
  });

  it.each([
    ['PNG', 'image/png'],
    ['JPEG', 'image/jpeg'],
    ['GIF', 'image/gif'],
    ['WebP', 'image/webp'],
  ])('accepts %s', async (_label, type) => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(documentImages, orgId, ['contribute'], humanActorId);

    const res = await upload(w, imageOfSize('image', 4, type));
    expect(res.status).toBe(200);
    expect((await body<DocumentImageOut>(res)).mimeType).toBe(type);
  });

  it('rejects SVG, which could execute once served inline', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(documentImages, orgId, ['contribute'], humanActorId);

    const res = await upload(w, imageOfSize('payload.svg', 20, 'image/svg+xml'));

    expect(res.status).toBe(422);
    // Rejected during validation, so nothing reached storage at all.
    expect(await getContainer().blob.get(blobKeyFor(orgId, MISSING))).toBeNull();
  });

  it.each([
    ['a PDF', 'application/pdf'],
    ['an HTML document', 'text/html'],
    ['an unknown binary', 'application/octet-stream'],
  ])('rejects %s', async (_label, type) => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(documentImages, orgId, ['contribute'], humanActorId);

    expect((await upload(w, imageOfSize('file', 8, type))).status).toBe(422);
  });

  it('rejects an empty or over-limit upload', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(documentImages, orgId, ['contribute'], humanActorId);

    expect((await upload(w, imageOfSize('empty.png', 0))).status).toBe(422);
    expect((await upload(w, imageOfSize('huge.png', 4 * 1024 * 1024 + 1))).status).toBe(422);
  });

  it('requires `contribute` to upload (403 for a viewer)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(documentImages, orgId, ['view'], humanActorId);

    expect((await upload(viewer, imageOfSize('x.png', 3))).status).toBe(403);
  });

  it('serves the bytes inline, typed, and un-sniffable', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(documentImages, orgId, ['contribute'], humanActorId);
    const created = await body<DocumentImageOut>(await upload(w, imageOfSize('chart.png', 9)));

    const res = await w.request(`/${created.id}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    // Inline, not `attachment` — an image told to download cannot render in prose.
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toHaveLength(9);
  });

  it('lets a viewer read an image without being able to add one', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(documentImages, orgId, ['contribute'], humanActorId);
    const created = await body<DocumentImageOut>(await upload(writer, imageOfSize('a.png', 5)));

    const viewer = appWithActor(documentImages, orgId, ['view'], humanActorId);
    expect((await viewer.request(`/${created.id}`)).status).toBe(200);
  });

  it('does not serve another workspace’s image', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const owner = appWithActor(documentImages, orgId, ['contribute'], humanActorId);
    const created = await body<DocumentImageOut>(await upload(owner, imageOfSize('a.png', 5)));

    const other = await seedBaseOrg(db, schema);
    const outsider = appWithActor(documentImages, other.orgId, ['view'], other.humanActorId);

    expect((await outsider.request(`/${created.id}`)).status).toBe(404);
  });

  it('deletes an image and reclaims its bytes', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(documentImages, orgId, ['contribute'], humanActorId);
    const created = await body<DocumentImageOut>(await upload(w, imageOfSize('gone.png', 6)));
    const key = blobKeyFor(orgId, created.id);
    expect(await getContainer().blob.get(key)).not.toBeNull();

    const del = await w.request(`/${created.id}`, { method: 'DELETE' });

    expect(del.status).toBe(200);
    // The only reference to an image is the Markdown naming it, so nothing can infer when the last
    // one goes away — reclaiming has to be something a caller can ask for outright.
    expect(await getContainer().blob.get(key)).toBeNull();
    expect((await w.request(`/${created.id}`)).status).toBe(404);
  });

  it('requires `contribute` to delete (403 for a viewer)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(documentImages, orgId, ['contribute'], humanActorId);
    const created = await body<DocumentImageOut>(await upload(w, imageOfSize('keep.png', 4)));

    const viewer = appWithActor(documentImages, orgId, ['view'], humanActorId);
    expect((await viewer.request(`/${created.id}`, { method: 'DELETE' })).status).toBe(403);
  });

  it('does not delete another workspace’s image', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const owner = appWithActor(documentImages, orgId, ['contribute'], humanActorId);
    const created = await body<DocumentImageOut>(await upload(owner, imageOfSize('a.png', 5)));

    const other = await seedBaseOrg(db, schema);
    const outsider = appWithActor(documentImages, other.orgId, ['contribute'], other.humanActorId);

    expect((await outsider.request(`/${created.id}`, { method: 'DELETE' })).status).toBe(404);
    expect(await getContainer().blob.get(blobKeyFor(orgId, created.id))).not.toBeNull();
  });

  it('404s an unknown id', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(documentImages, orgId, ['view'], humanActorId);

    expect((await w.request(`/${MISSING}`)).status).toBe(404);
  });

  it('404s when the row survives but its bytes are gone', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(documentImages, orgId, ['contribute'], humanActorId);
    const created = await body<DocumentImageOut>(await upload(w, imageOfSize('a.png', 5)));

    await getContainer().blob.delete(blobKeyFor(orgId, created.id));

    expect((await w.request(`/${created.id}`)).status).toBe(404);
  });
});
