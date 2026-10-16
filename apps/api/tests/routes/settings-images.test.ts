import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getContainer } from '../../src/container';
import { env } from '../../src/env';
import { storeSettingsImage } from '../../src/lib/settings-image';
import { appWithSession, getDb, seedOrg, seedUserWithHub } from '../support/routes-harness';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/MkAAAAASUVORK5CYII=',
  'base64',
);
const DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;

/** Anonymous image router, matching its public production mount. */
async function imageApp() {
  const { settingsImages } = await import('../../src/routes/settings-images');
  return appWithSession(settingsImages, null);
}

describe('managed Settings images', () => {
  it('returns a stable API URL rather than a provider URL or selected data payload', async () => {
    const schema = await getDb();
    const id = await seedUserWithHub(schema.db, schema, 'SelectedImage');
    expect(await storeSettingsImage(`settings/profile/${id}`, DATA_URL)).toBe(
      `${env.API_URL}/v1/public/settings-images/profile/${id}`,
    );
    await expect(storeSettingsImage(`exports/account/${id}`, DATA_URL)).rejects.toThrow();
  });

  it('serves the currently selected profile image anonymously and revokes a removed reference', async () => {
    const schema = await getDb();
    const id = await seedUserWithHub(schema.db, schema, 'PublicProfileImage');
    const image = await storeSettingsImage(`settings/profile/${id}`, DATA_URL);
    await schema.db.update(schema.user).set({ image }).where(eq(schema.user.id, id));
    const app = await imageApp();
    const response = await app.request(`/profile/${id}`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(PNG));
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    await schema.db.update(schema.user).set({ image: null }).where(eq(schema.user.id, id));
    expect((await app.request(`/profile/${id}`)).status).toBe(404);
  });

  it('serves selected workspace images but hides archived workspaces', async () => {
    const schema = await getDb();
    const id = await seedOrg(schema.db, schema);
    const avatar = await storeSettingsImage(`settings/workspace/${id}`, DATA_URL);
    await schema.db
      .update(schema.organization)
      .set({ avatar })
      .where(eq(schema.organization.id, id));
    const app = await imageApp();
    expect((await app.request(`/workspace/${id}`)).status).toBe(200);
    await schema.db
      .update(schema.organization)
      .set({ archivedAt: new Date() })
      .where(eq(schema.organization.id, id));
    expect((await app.request(`/workspace/${id}`)).status).toBe(404);
  });

  it('never serves external or another record’s image references, or arbitrary storage prefixes', async () => {
    const schema = await getDb();
    const first = await seedUserWithHub(schema.db, schema, 'FirstImage');
    const second = await seedUserWithHub(schema.db, schema, 'SecondImage');
    const image = await storeSettingsImage(`settings/profile/${first}`, DATA_URL);
    await storeSettingsImage(`settings/profile/${second}`, DATA_URL);
    await schema.db.update(schema.user).set({ image }).where(eq(schema.user.id, second));
    const app = await imageApp();
    expect((await app.request(`/profile/${second}`)).status).toBe(404);
    await schema.db
      .update(schema.user)
      .set({ image: 'https://identity.example/avatar.png' })
      .where(eq(schema.user.id, first));
    expect((await app.request(`/profile/${first}`)).status).toBe(404);
    for (const path of [
      '/exports/account/secret',
      '/attachments/secret',
      '/profile/%2E%2E%2Fsecret',
      '/workspace/missing',
    ]) {
      expect((await app.request(path)).status).toBe(404);
    }
  });

  it('rejects missing, oversized, and non-raster stored bytes', async () => {
    const schema = await getDb();
    const id = await seedUserWithHub(schema.db, schema, 'InvalidImage');
    const key = `settings/profile/${id}`;
    const image = await storeSettingsImage(key, DATA_URL);
    await schema.db.update(schema.user).set({ image }).where(eq(schema.user.id, id));
    const app = await imageApp();
    await getContainer().blob.delete(key);
    expect((await app.request(`/profile/${id}`)).status).toBe(404);
    await getContainer().blob.put(
      key,
      new TextEncoder().encode('<svg onload="alert(1)"></svg>'),
      'image/png',
    );
    expect((await app.request(`/profile/${id}`)).status).toBe(404);
    const oversized = new Uint8Array(1024 * 1024 + 1);
    oversized.set(PNG);
    await getContainer().blob.put(key, oversized, 'image/png');
    expect((await app.request(`/profile/${id}`)).status).toBe(404);
  });
});
