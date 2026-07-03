import { describe, expect, it } from 'vitest';

import {
  collectWorkspacePackages,
  type DependencySection,
  relativeToWorkspaceRoot,
} from './workspace';

const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const satisfies readonly DependencySection[];

const TOOLCHAIN_CATALOG_DEPENDENCIES = new Set([
  '@eslint/js',
  '@types/node',
  '@vitejs/plugin-react',
  '@vitest/coverage-v8',
  'eslint',
  'typescript',
  'typescript-eslint',
  'vite',
  'vitest',
]);

describe('dependency catalog policy', () => {
  it('uses the pnpm catalog for shared toolchain dependency versions', () => {
    const literals: string[] = [];
    for (const { manifest, manifestPath } of collectWorkspacePackages()) {
      for (const section of DEPENDENCY_SECTIONS) {
        const dependencies = manifest[section] ?? {};
        for (const [dependency, specifier] of Object.entries(dependencies)) {
          if (TOOLCHAIN_CATALOG_DEPENDENCIES.has(dependency) && specifier !== 'catalog:') {
            literals.push(
              `${relativeToWorkspaceRoot(manifestPath)} ${section}.${dependency} = ${specifier}`,
            );
          }
        }
      }
    }
    expect(literals, `Use catalog: for shared toolchain versions:\n${literals.join('\n')}`).toEqual(
      [],
    );
  });
});
