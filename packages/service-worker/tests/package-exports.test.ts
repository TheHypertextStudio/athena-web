import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly name: string;
  readonly exports: Readonly<Record<string, string>>;
}

const packageRoot = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(
  readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
) as PackageManifest;
const requireFromPackage = createRequire(resolve(packageRoot, 'package.json'));

function specifierFor(subpath: string): string {
  return subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
}

describe('@docket/service-worker package exports', () => {
  it.each(Object.keys(manifest.exports))('resolves the declared %s public module', (subpath) => {
    expect(() => requireFromPackage.resolve(specifierFor(subpath))).not.toThrow();
  });
});
