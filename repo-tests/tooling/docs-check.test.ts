import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkDocs } from '../../scripts/docs-check';

function docsFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'docket-docs-check-'));
  mkdirSync(join(root, 'guides'));
  writeFileSync(
    join(root, 'docs.json'),
    JSON.stringify({
      name: 'Docket',
      navigation: { tabs: [{ tab: 'Guides', pages: ['guides/start'] }] },
      navbar: {
        primary: { href: 'https://docket.hypertext.studio' },
      },
    }),
  );
  return root;
}

describe('public documentation check', () => {
  it('accepts configured pages with useful frontmatter and valid local links', () => {
    const root = docsFixture();
    writeFileSync(
      join(root, 'guides/start.mdx'),
      `---\ntitle: 'Start'\ndescription: 'Set up Docket and create the first task.'\n---\n\n# Start\n\n[Return here](/guides/start#start).\n`,
    );

    expect(checkDocs(root)).toEqual([]);
  });

  it('reports orphan pages, broken links, weak frontmatter, and demo copy', () => {
    const root = docsFixture();
    writeFileSync(
      join(root, 'guides/start.mdx'),
      `---\ntitle: 'Start'\ndescription: 'Short'\n---\n\n# Start\n\nOpen the Docket Documentation Demo. Read [Missing](/guides/missing).\n`,
    );
    writeFileSync(
      join(root, 'guides/orphan.mdx'),
      `---\ntitle: 'Orphan'\ndescription: 'This page is not in navigation.'\n---\n`,
    );

    expect(checkDocs(root)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('description must explain the page'),
        expect.stringContaining('forbidden demo copy'),
        expect.stringContaining('broken local link'),
        expect.stringContaining('is not present in navigation'),
      ]),
    );
  });

  it('reports duplicate titles and redirects that do not land on a page', () => {
    const root = docsFixture();
    writeFileSync(
      join(root, 'docs.json'),
      JSON.stringify({
        name: 'Docket',
        navigation: { tabs: [{ tab: 'Guides', pages: ['guides/start', 'guides/second'] }] },
        redirects: [
          { source: '/guides/old', destination: '/guides/missing' },
          { source: '/guides/second', destination: '/guides/start' },
        ],
        navbar: { primary: { href: 'https://docket.hypertext.studio' } },
      }),
    );
    for (const page of ['start', 'second']) {
      writeFileSync(
        join(root, `guides/${page}.mdx`),
        `---\ntitle: 'Shared title'\ndescription: 'This description is long enough for the source check.'\n---\n`,
      );
    }

    expect(checkDocs(root)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('duplicate title'),
        expect.stringContaining('redirect destination does not exist'),
        expect.stringContaining('redirect source still exists'),
      ]),
    );
  });
});
