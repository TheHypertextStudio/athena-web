#!/usr/bin/env node
// Check only staged source paths after the index-safe formatter has completed.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
process.chdir(root);
const extensions = new Set(['.ts', '.tsx']);
const files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
  .toString('utf8')
  .split('\0')
  .filter((file) => file && extensions.has(path.extname(file)));
const groups = new Map();
for (const file of files) {
  const [scope, name] = file.split('/');
  const group = ['apps', 'domains', 'packages', 'tooling'].includes(scope)
    ? `${scope}/${name}`
    : scope;
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push(file);
}
for (const group of groups.values()) {
  for (let offset = 0; offset < group.length; offset += 100) {
    const result = spawnSync(
      process.execPath,
      [
        '--max-old-space-size=4096',
        path.join(root, 'node_modules/eslint/bin/eslint.js'),
        '--max-warnings=0',
        '--no-warn-ignored',
        '--',
        ...group.slice(offset, offset + 100),
      ],
      { stdio: 'inherit' },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
