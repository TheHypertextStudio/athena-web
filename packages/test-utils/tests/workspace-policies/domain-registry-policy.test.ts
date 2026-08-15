import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectWorkspacePackages,
  isProductionSourceFile,
  isSourceLocalTestPath,
  relativeToWorkspaceRoot,
  WORKSPACE_ROOT,
} from '../workspace';

const DOMAIN_REGISTRY_PATH = resolve(WORKSPACE_ROOT, 'domains/registry.json');
const DOMAIN_ROOT = resolve(WORKSPACE_ROOT, 'domains');
const DEPLOYABLE_RUNTIMES = new Set(['admin', 'api', 'desktop', 'runner', 'web']);
const SIMPLE_DOMAIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface DomainRegistration {
  readonly allowedRuntimeDependencies: readonly string[];
  readonly description: string;
  readonly id: string;
  readonly packageName: string;
  readonly productOwner: string;
  readonly publicExports: readonly string[];
  readonly supportedDeployableRuntimes: readonly string[];
}

interface DomainRegistry {
  readonly domains: readonly DomainRegistration[];
  readonly version: number;
}

interface DomainManifest {
  readonly dependencies?: Record<string, string>;
  readonly exports?: unknown;
  readonly imports?: unknown;
  readonly main?: unknown;
  readonly name?: string;
  readonly types?: unknown;
}

interface DomainPackage {
  readonly manifest: DomainManifest;
  readonly manifestPath: string;
}

function readDomainRegistry(): DomainRegistry {
  return JSON.parse(readFileSync(DOMAIN_REGISTRY_PATH, 'utf8')) as DomainRegistry;
}

function domainPackages(): DomainPackage[] {
  return collectWorkspacePackages()
    .filter((workspacePackage) => workspacePackage.group === 'domains')
    .map(({ manifest, manifestPath }) => ({
      manifest,
      manifestPath,
    }));
}

function isExportObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function manifestExportNames(manifest: DomainManifest): string[] {
  if (typeof manifest.exports === 'string') return ['.'];
  if (!isExportObject(manifest.exports)) return [];
  const exportNames = Object.keys(manifest.exports);
  return exportNames.some((exportName) => exportName.startsWith('.')) ? exportNames : ['.'];
}

function duplicateValues(values: readonly string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function isWildcardExport(exportName: string): boolean {
  return exportName.includes('*');
}

function canonicalDomainManifestPath(id: string): string | undefined {
  return SIMPLE_DOMAIN_ID.test(id) ? `${DOMAIN_ROOT}/${id}/package.json` : undefined;
}

function isCanonicalSourceFileTarget(target: string): boolean {
  if (!target.startsWith('./src/') || target.includes('\\')) return false;
  const segments = target.slice('./src/'.length).split('/');
  return (
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..') &&
    !isSourceLocalTestPath(target, './src') &&
    isProductionSourceFile(target)
  );
}

function describeExportTarget(value: unknown): string {
  if (Array.isArray(value)) return 'an array';
  return JSON.stringify(value);
}

function conditionalExportTargetViolations(
  target: unknown,
  location: string,
  targetPath: string,
): string[] {
  if (typeof target === 'string') {
    return isCanonicalSourceFileTarget(target)
      ? []
      : [
          `${location} export target ${targetPath} must be a canonical ./src/ file, found ${JSON.stringify(target)}`,
        ];
  }
  if (!isExportObject(target)) {
    return [
      `${location} export target ${targetPath} must be a string, found ${describeExportTarget(target)}`,
    ];
  }
  const entries = Object.entries(target);
  if (entries.length === 0) {
    return [`${location} export target ${targetPath} must not be an empty conditional object`];
  }
  return entries.flatMap(([condition, nestedTarget]) =>
    conditionalExportTargetViolations(nestedTarget, location, `${targetPath}.${condition}`),
  );
}

function manifestExportTargetViolations(manifest: DomainManifest, location: string): string[] {
  if (manifest.exports === undefined) return [];
  if (typeof manifest.exports === 'string' || !isExportObject(manifest.exports)) {
    return conditionalExportTargetViolations(manifest.exports, location, '.');
  }
  const exportNames = Object.keys(manifest.exports);
  if (!exportNames.some((exportName) => exportName.startsWith('.'))) {
    return conditionalExportTargetViolations(manifest.exports, location, '.');
  }
  return Object.entries(manifest.exports).flatMap(([exportName, target]) =>
    conditionalExportTargetViolations(target, location, exportName),
  );
}

function domainRegistryViolations(
  registry: DomainRegistry,
  packages: readonly DomainPackage[],
): string[] {
  const violations: string[] = [];
  if (registry.version !== 1) {
    violations.push(
      `domains/registry.json must declare version 1, found ${String(registry.version)}`,
    );
  }

  const packageNames = registry.domains.map((domain) => domain.packageName);
  const domainIds = registry.domains.map((domain) => domain.id);
  for (const duplicate of duplicateValues(packageNames)) {
    violations.push(`domains/registry.json duplicates package ${duplicate}`);
  }
  for (const duplicate of duplicateValues(domainIds)) {
    violations.push(`domains/registry.json duplicates domain id ${duplicate}`);
  }

  for (const domain of registry.domains) {
    if (!domain.id || !domain.packageName || !domain.productOwner || !domain.description) {
      violations.push(
        `domains/registry.json entry ${domain.id || '<unknown>'} lacks identity or ownership`,
      );
    }
    if (!SIMPLE_DOMAIN_ID.test(domain.id)) {
      violations.push(`domains/registry.json entry ${domain.id} must use a canonical simple id`);
    }
    if (SIMPLE_DOMAIN_ID.test(domain.id) && domain.packageName !== `@docket/${domain.id}`) {
      violations.push(
        `domains/registry.json entry ${domain.id} must declare canonical package @docket/${domain.id}, found ${domain.packageName}`,
      );
    }
    if (domain.publicExports.length === 0) {
      violations.push(
        `domains/registry.json entry ${domain.id} must declare at least one public export`,
      );
    }
    for (const duplicate of duplicateValues(domain.publicExports)) {
      violations.push(
        `domains/registry.json entry ${domain.id} duplicates public export ${duplicate}`,
      );
    }
    for (const exportName of domain.publicExports) {
      if (isWildcardExport(exportName)) {
        violations.push(
          `domains/registry.json entry ${domain.id} declares forbidden wildcard export ${exportName}`,
        );
      }
    }
    for (const duplicate of duplicateValues(domain.allowedRuntimeDependencies)) {
      violations.push(
        `domains/registry.json entry ${domain.id} duplicates runtime dependency ${duplicate}`,
      );
    }
    for (const runtime of domain.supportedDeployableRuntimes) {
      if (!DEPLOYABLE_RUNTIMES.has(runtime)) {
        violations.push(`domains/registry.json entry ${domain.id} has unknown runtime ${runtime}`);
      }
    }
    for (const duplicate of duplicateValues(domain.supportedDeployableRuntimes)) {
      violations.push(`domains/registry.json entry ${domain.id} duplicates runtime ${duplicate}`);
    }
  }

  const registrationsByPackage = new Map(
    registry.domains.map((domain) => [domain.packageName, domain]),
  );

  for (const domain of registry.domains) {
    const expectedManifestPath = canonicalDomainManifestPath(domain.id);
    if (!expectedManifestPath) continue;
    const expectedPackage = packages.find((pkg) => pkg.manifestPath === expectedManifestPath);
    const expectedLocation = relativeToWorkspaceRoot(expectedManifestPath);
    if (!expectedPackage) {
      violations.push(
        `${expectedLocation} is missing registered package ${domain.packageName} for ${domain.id}`,
      );
      continue;
    }
    const manifestName = expectedPackage.manifest.name ?? '<unnamed>';
    if (manifestName !== domain.packageName) {
      violations.push(
        `${expectedLocation} declares ${manifestName}, expected ${domain.packageName} for ${domain.id}`,
      );
    }
  }

  for (const pkg of packages) {
    const manifestName = pkg.manifest.name;
    const location = relativeToWorkspaceRoot(pkg.manifestPath);
    const exportNames = manifestExportNames(pkg.manifest);
    violations.push(...manifestExportTargetViolations(pkg.manifest, location));
    if (pkg.manifest.imports !== undefined) {
      violations.push(`${location} declares forbidden imports metadata`);
    }
    const registration = manifestName ? registrationsByPackage.get(manifestName) : undefined;
    if (!registration) {
      violations.push(`${location} is missing a domains/registry.json entry`);
      continue;
    }

    const expectedManifestPath = canonicalDomainManifestPath(registration.id);
    if (!expectedManifestPath) continue;
    if (pkg.manifestPath !== expectedManifestPath) {
      violations.push(
        `${location} declares registered package ${manifestName}, but registry id ${registration.id} requires ${relativeToWorkspaceRoot(expectedManifestPath)}`,
      );
    }

    for (const exportName of exportNames) {
      if (isWildcardExport(exportName)) {
        violations.push(`${location} exposes forbidden wildcard export ${exportName}`);
      }
    }
    if (exportNames.includes('.')) {
      violations.push(`${location} exposes a forbidden root export`);
    }
    if (pkg.manifest.main !== undefined) {
      violations.push(`${location} declares forbidden main metadata`);
    }
    if (pkg.manifest.types !== undefined) {
      violations.push(`${location} declares forbidden types metadata`);
    }

    const declaredExports = new Set(registration.publicExports);
    for (const exportName of exportNames) {
      if (!declaredExports.has(exportName)) {
        violations.push(
          `${location} exposes ${exportName}, which is absent from the ${registration.id} registry entry`,
        );
      }
    }
    for (const exportName of registration.publicExports) {
      if (!exportNames.includes(exportName)) {
        violations.push(
          `${location} is missing registered export ${exportName} for ${registration.id}`,
        );
      }
    }

    const allowedDependencies = new Set(registration.allowedRuntimeDependencies);
    for (const dependency of Object.keys(pkg.manifest.dependencies ?? {})) {
      if (!allowedDependencies.has(dependency)) {
        violations.push(
          `${location} declares runtime dependency ${dependency}, which is absent from the ${registration.id} registry entry`,
        );
      }
    }
  }

  return violations;
}

const fixtureRegistration = {
  allowedRuntimeDependencies: ['zod'],
  description: 'A focused test domain.',
  id: 'fixture',
  packageName: '@docket/fixture',
  productOwner: 'Fixture',
  publicExports: ['./contract'],
  supportedDeployableRuntimes: ['api'],
} as const satisfies DomainRegistration;

function fixturePackage(manifest: DomainManifest, id = 'fixture'): DomainPackage {
  return {
    manifest,
    manifestPath: resolve(DOMAIN_ROOT, id, 'package.json'),
  };
}

describe('domain registry policy', () => {
  it('declares the active Athena, Automation, Billing, Connections, Identity & Access, and Work domains', () => {
    const registry = readDomainRegistry();

    expect(registry.domains.map((domain) => domain.packageName)).toEqual([
      '@docket/athena',
      '@docket/automation',
      '@docket/billing',
      '@docket/connections',
      '@docket/identity-access',
      '@docket/work',
    ]);
    for (const domain of registry.domains) {
      expect(domain.productOwner).not.toEqual('');
      expect(domain.description).not.toEqual('');
      expect(domain.publicExports.length).toBeGreaterThan(0);
      expect(domain.supportedDeployableRuntimes.length).toBeGreaterThan(0);
    }
  });

  it('declares Automation as a portable zod-only rule-language domain', () => {
    const registry = readDomainRegistry();
    const automation = registry.domains.find(
      (domain) => domain.packageName === '@docket/automation',
    );

    expect(automation).toEqual(
      expect.objectContaining({
        id: 'automation',
        packageName: '@docket/automation',
        productOwner: 'Automation',
      }),
    );
    expect(automation?.publicExports).toEqual(['./contracts', './evaluation']);
    expect(automation?.allowedRuntimeDependencies).toEqual(['zod']);
    expect(automation?.supportedDeployableRuntimes).toEqual([
      'api',
      'web',
      'admin',
      'runner',
      'desktop',
    ]);
  });

  it('declares Billing as an API-only deployable domain', () => {
    const registry = readDomainRegistry();
    const billing = registry.domains.find((domain) => domain.packageName === '@docket/billing');

    expect(billing?.supportedDeployableRuntimes).toEqual(['api']);
  });

  it("declares Billing's exact five public entrypoints", () => {
    const registry = readDomainRegistry();
    const billing = registry.domains.find((domain) => domain.packageName === '@docket/billing');

    expect(billing?.publicExports).toEqual([
      './contracts',
      './adapters/in-memory',
      './adapters/stripe',
      './application/lifecycle',
      './application/entitlement',
    ]);
  });

  it('keeps every present domain package aligned with its registry contract', () => {
    const violations = domainRegistryViolations(readDomainRegistry(), domainPackages());

    expect(
      violations,
      [
        'Every domain package must be owned and described in domains/registry.json.',
        'Domain packages expose only deliberate named entrypoints and list each production dependency.',
        violations.join('\n'),
      ].join('\n'),
    ).toEqual([]);
  });

  it('rejects a domain package with no registry entry', () => {
    expect(
      domainRegistryViolations({ domains: [], version: 1 }, [
        fixturePackage({ name: '@docket/fixture' }),
      ]),
    ).toContain('domains/fixture/package.json is missing a domains/registry.json entry');
  });

  it('requires every registry entry to resolve its declared package directory and name', () => {
    const ghostRegistration = {
      ...fixtureRegistration,
      id: 'ghost',
      packageName: '@docket/ghost',
    };
    const wrongNameRegistration = {
      ...fixtureRegistration,
      id: 'wrong-name',
      packageName: '@docket/wrong-name',
    };
    const misplacedRegistration = {
      ...fixtureRegistration,
      id: 'right-directory',
      packageName: '@docket/misplaced',
    };

    const violations = domainRegistryViolations(
      {
        domains: [ghostRegistration, wrongNameRegistration, misplacedRegistration],
        version: 1,
      },
      [
        fixturePackage({ name: '@docket/not-the-right-name' }, 'wrong-name'),
        fixturePackage({ name: '@docket/misplaced' }, 'wrong-directory'),
      ],
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        'domains/ghost/package.json is missing registered package @docket/ghost for ghost',
        'domains/wrong-name/package.json declares @docket/not-the-right-name, expected @docket/wrong-name for wrong-name',
        'domains/right-directory/package.json is missing registered package @docket/misplaced for right-directory',
        'domains/wrong-directory/package.json declares registered package @docket/misplaced, but registry id right-directory requires domains/right-directory/package.json',
      ]),
    );
  });

  it('rejects non-canonical domain IDs before they can alias a package directory', () => {
    const traversalRegistration = {
      ...fixtureRegistration,
      id: 'billing/../work',
    };
    const trailingSeparatorRegistration = {
      ...fixtureRegistration,
      id: 'work/',
    };

    const violations = domainRegistryViolations(
      {
        domains: [traversalRegistration, trailingSeparatorRegistration],
        version: 1,
      },
      [fixturePackage({ name: '@docket/fixture' }, 'work')],
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        'domains/registry.json entry billing/../work must use a canonical simple id',
        'domains/registry.json entry work/ must use a canonical simple id',
      ]),
    );
  });

  it('requires registry package names to canonically derive from their domain IDs', () => {
    const wrongScopeRegistration = {
      ...fixtureRegistration,
      id: 'wrong-scope',
      packageName: '@other/wrong-scope',
    };
    const wrongIdRegistration = {
      ...fixtureRegistration,
      id: 'wrong-id',
      packageName: '@docket/not-wrong-id',
    };

    const violations = domainRegistryViolations(
      { domains: [wrongScopeRegistration, wrongIdRegistration], version: 1 },
      [
        fixturePackage(
          { exports: { './contract': './src/contract.ts' }, name: '@other/wrong-scope' },
          'wrong-scope',
        ),
        fixturePackage(
          { exports: { './contract': './src/contract.ts' }, name: '@docket/not-wrong-id' },
          'wrong-id',
        ),
      ],
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        'domains/registry.json entry wrong-scope must declare canonical package @docket/wrong-scope, found @other/wrong-scope',
        'domains/registry.json entry wrong-id must declare canonical package @docket/wrong-id, found @docket/not-wrong-id',
      ]),
    );
  });

  it('accepts canonical source-file targets in nested conditional exports', () => {
    const violations = domainRegistryViolations({ domains: [fixtureRegistration], version: 1 }, [
      fixturePackage({
        exports: {
          './contract': {
            default: './src/contract.ts',
            node: { import: './src/contract.mts' },
            types: './src/contract.ts',
          },
        },
        name: '@docket/fixture',
      }),
    ]);

    expect(violations).toEqual([]);
  });

  it('rejects malformed and escaping targets at every conditional export depth', () => {
    const violations = domainRegistryViolations({ domains: [fixtureRegistration], version: 1 }, [
      fixturePackage({
        exports: {
          './contract': {
            browser: {},
            default: './src/../private.ts',
            import: './src/contract',
            nestedTest: './src/adapters/__tests__/contract.ts',
            node: ['./src/contract.ts'],
            require: false,
            types: './runtime/contracts',
          },
        },
        name: '@docket/fixture',
      }),
    ]);

    expect(violations).toEqual(
      expect.arrayContaining([
        'domains/fixture/package.json export target ./contract.types must be a canonical ./src/ file, found "./runtime/contracts"',
        'domains/fixture/package.json export target ./contract.default must be a canonical ./src/ file, found "./src/../private.ts"',
        'domains/fixture/package.json export target ./contract.import must be a canonical ./src/ file, found "./src/contract"',
        'domains/fixture/package.json export target ./contract.nestedTest must be a canonical ./src/ file, found "./src/adapters/__tests__/contract.ts"',
        'domains/fixture/package.json export target ./contract.require must be a string, found false',
        'domains/fixture/package.json export target ./contract.node must be a string, found an array',
        'domains/fixture/package.json export target ./contract.browser must not be an empty conditional object',
      ]),
    );
  });

  it('rejects wildcard export patterns from both registry and manifest contracts', () => {
    const wildcardRegistration = {
      ...fixtureRegistration,
      publicExports: ['./*', './adapters/*'],
    };
    const violations = domainRegistryViolations({ domains: [wildcardRegistration], version: 1 }, [
      fixturePackage({
        exports: {
          './*': './src/index.ts',
          './adapters/*': './src/adapters/*.ts',
        },
        name: '@docket/fixture',
      }),
    ]);

    expect(violations).toEqual(
      expect.arrayContaining([
        'domains/registry.json entry fixture declares forbidden wildcard export ./*',
        'domains/registry.json entry fixture declares forbidden wildcard export ./adapters/*',
        'domains/fixture/package.json exposes forbidden wildcard export ./*',
        'domains/fixture/package.json exposes forbidden wildcard export ./adapters/*',
      ]),
    );
  });

  it('rejects root package metadata and undeclared exports', () => {
    const violations = domainRegistryViolations({ domains: [fixtureRegistration], version: 1 }, [
      fixturePackage({
        exports: {
          '.': './src/index.ts',
          './contract': './src/contract.ts',
          './private': './src/private.ts',
        },
        main: './src/index.ts',
        name: '@docket/fixture',
        types: './src/index.ts',
      }),
    ]);

    expect(violations).toEqual(
      expect.arrayContaining([
        'domains/fixture/package.json exposes a forbidden root export',
        'domains/fixture/package.json declares forbidden main metadata',
        'domains/fixture/package.json declares forbidden types metadata',
        'domains/fixture/package.json exposes ., which is absent from the fixture registry entry',
        'domains/fixture/package.json exposes ./private, which is absent from the fixture registry entry',
      ]),
    );
  });

  it('forbids package imports maps on domain manifests', () => {
    const violations = domainRegistryViolations({ domains: [fixtureRegistration], version: 1 }, [
      fixturePackage({
        exports: { './contract': './src/contract.ts' },
        imports: { '#private': './src/private.ts' },
        name: '@docket/fixture',
      }),
    ]);

    expect(violations).toContain(
      'domains/fixture/package.json declares forbidden imports metadata',
    );
  });

  it('rejects runtime dependencies absent from the domain contract', () => {
    const violations = domainRegistryViolations({ domains: [fixtureRegistration], version: 1 }, [
      fixturePackage({
        dependencies: { stripe: '22.3.0', zod: 'catalog:' },
        exports: { './contract': './src/contract.ts' },
        name: '@docket/fixture',
      }),
    ]);

    expect(violations).toContain(
      'domains/fixture/package.json declares runtime dependency stripe, which is absent from the fixture registry entry',
    );
  });
});
