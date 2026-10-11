import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { generate } from '@thehypertextstudio/web-docs';

const docs = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('generated config preserves Docket appearance, navigation, redirects, and links', () => {
  generate(docs, true);
  const product = JSON.parse(readFileSync(join(docs, 'docs.site.json'), 'utf8'));
  const generated = JSON.parse(readFileSync(join(docs, 'docs.json'), 'utf8'));
  assert.deepEqual(generated, { $schema: 'https://mintlify.com/docs.json', ...product });
  assert.equal(generated.theme, 'maple');
  assert.equal(generated.fonts.heading.family, 'Fraunces');
  assert.equal(generated.fonts.body.family, 'IBM Plex Sans');
  assert.equal(generated.navbar.primary.href, 'https://clearthedocket.com');
  assert.equal(generated.redirects.length, 6);
});

test('config check rejects stale output and regeneration repairs it deterministically', () => {
  const root = mkdtempSync(join(tmpdir(), 'docket-docs-config-'));
  try {
    writeFileSync(join(root, 'start.mdx'), '# Start\n');
    writeFileSync(
      join(root, 'docs.site.json'),
      JSON.stringify({ name: 'Docket', theme: 'maple', navigation: { pages: ['start'] } }),
    );
    writeFileSync(join(root, 'docs.json'), '{}\n');
    assert.throws(() => generate(root, true), /stale/);
    generate(root);
    const first = readFileSync(join(root, 'docs.json'), 'utf8');
    generate(root);
    assert.equal(readFileSync(join(root, 'docs.json'), 'utf8'), first);
    assert.doesNotThrow(() => generate(root, true));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
