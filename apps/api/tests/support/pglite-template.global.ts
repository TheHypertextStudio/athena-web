import { ensurePgliteTemplate } from './pglite-template';

/** Build the migrated PGlite snapshot once, before any test file starts. */
export default async function setup(): Promise<void> {
  await ensurePgliteTemplate();
}
