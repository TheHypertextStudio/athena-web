import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import * as prettier from 'prettier';
import { expect, it } from 'vitest';

it('applies native file overrides when the staged formatter loads an ESM configuration', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'docket-formatter-'));
  try {
    const tools = join(fixture, '.hypertext/formatter-tools');
    mkdirSync(tools, { recursive: true });
    symlinkSync(resolve('node_modules'), join(fixture, 'node_modules'));
    const spec = { prettier: { manifest: 'package.json' }, npm: {} };
    writeFileSync(
      join(fixture, 'package.json'),
      JSON.stringify({ type: 'module', devDependencies: { prettier: prettier.version } }),
    );
    writeFileSync(join(tools, 'tools.json'), JSON.stringify(spec));
    writeFileSync(
      join(tools, 'runtime.json'),
      JSON.stringify({ npm: resolve('node_modules'), prettier: prettier.version, spec }),
    );
    writeFileSync(
      join(tools, 'prettier.mjs'),
      readFileSync('.hypertext/formatter-tools/prettier.mjs'),
    );
    writeFileSync(
      join(fixture, 'prettier.config.mjs'),
      "export default { singleQuote: true, overrides: [{ files: '*.md', options: { singleQuote: false } }] };\n",
    );
    const filepath = join(fixture, 'example.md');
    const source = "```js\nconst label = 'Starting work';\n```\n";
    writeFileSync(filepath, source);
    const config = await prettier.resolveConfig(filepath);
    const expected = await prettier.format(source, { ...config, filepath });
    const result = spawnSync(
      process.execPath,
      [join(tools, 'prettier.mjs'), 'example.md', 'markdown'],
      { input: source, encoding: 'utf8', cwd: fixture },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(expected);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
