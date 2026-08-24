import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  collectWorkspacePackages,
  collectWorkspaceSourceFiles,
  collectPackageProductionEntrypointFiles,
  collectPackageSourceFiles,
  hasConventionalTestDirectory,
  isPackageProductionEntrypointFile,
  isSourceLocalTestPath,
  relativeToWorkspaceRoot,
  WORKSPACE_ROOT,
} from '../workspace';

type DomainImportRule =
  | 'app-delivery'
  | 'app-source'
  | 'dynamic-module-specifier'
  | 'domain-private'
  | 'environment'
  | 'generic-types'
  | 'module-loader-alias'
  | 'package-import-alias'
  | 'source-escape'
  | 'testing'
  | 'unsupported-deployable-runtime'
  | 'user-interface'
  | 'workspace-dependency'
  | 'workspace-private';

interface DomainImportViolation {
  readonly column: number;
  readonly file: string;
  readonly line: number;
  readonly rule: DomainImportRule;
  readonly specifier: string;
}

interface DomainRegistration {
  readonly allowedRuntimeDependencies: readonly string[];
  readonly packageName: string;
  readonly supportedDeployableRuntimes: readonly string[];
}

interface DomainRegistry {
  readonly domains: readonly DomainRegistration[];
}

const APPS_DIRECTORY = resolve(WORKSPACE_ROOT, 'apps');
const DOMAINS_DIRECTORY = resolve(WORKSPACE_ROOT, 'domains');
const DOMAIN_REGISTRY_PATH = resolve(DOMAINS_DIRECTORY, 'registry.json');
const DELIVERY_APP_RUNTIMES = ['admin', 'api', 'desktop', 'runner', 'web'] as const;
type DeliveryAppRuntime = (typeof DELIVERY_APP_RUNTIMES)[number];
const DELIVERY_APP_SOURCE_DIRECTORIES: Readonly<Record<DeliveryAppRuntime, string>> = {
  admin: resolve(APPS_DIRECTORY, 'admin', 'src'),
  api: resolve(APPS_DIRECTORY, 'api', 'src'),
  desktop: resolve(APPS_DIRECTORY, 'desktop', 'src'),
  runner: resolve(APPS_DIRECTORY, 'runner', 'src'),
  web: resolve(APPS_DIRECTORY, 'web', 'src'),
};
const DELIVERY_APP_DIRECTORIES: Readonly<Record<DeliveryAppRuntime, string>> = {
  admin: resolve(APPS_DIRECTORY, 'admin'),
  api: resolve(APPS_DIRECTORY, 'api'),
  desktop: resolve(APPS_DIRECTORY, 'desktop'),
  runner: resolve(APPS_DIRECTORY, 'runner'),
  web: resolve(APPS_DIRECTORY, 'web'),
};
/** These apps configure `@/*` as a local `src/*` alias in their tsconfig. */
const SOURCE_ROOT_ALIASED_DELIVERY_RUNTIMES = new Set<DeliveryAppRuntime>(['admin', 'web']);
/**
 * API-owned public transport contract for delivery clients.
 *
 * This exact type-only subpath is not an app-source exception or a shared types package: delivery
 * apps may reference it only from erased TypeScript type positions.
 */
const API_RPC_TRANSPORT_CONTRACT_SPECIFIER = '@docket/api/rpc-contract';
const APP_DELIVERY_SPECIFIER = /^@docket\/(?:admin|api|desktop|runner|web)(?:\/|$)/;
const ENVIRONMENT_SPECIFIER = /^@docket\/env(?:\/|$)/;
const GENERIC_TYPES_SPECIFIER = /^@docket\/types(?:\/|$)/;
const MODULE_LOADER_SPECIFIERS = new Set(['module', 'node:module']);
const PROCESS_MODULE_SPECIFIERS = new Set(['process', 'node:process']);
const TEST_FILE_SUBPATH = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TESTING_SUBPATH = /(?:^|\/)testing(?:\/|$)/;
const USER_INTERFACE_SPECIFIER = /^@docket\/ui(?:\/|$)/;
const DOMAIN_SOURCE_SPECIFIER = /^(@docket\/[^/]+)\/src(?:\/|$)/;
const WORKSPACE_PACKAGES = collectWorkspacePackages();
const DOMAIN_PACKAGE_NAMES = new Set(
  WORKSPACE_PACKAGES.filter((workspacePackage) => workspacePackage.group === 'domains').flatMap(
    (workspacePackage) => (workspacePackage.manifest.name ? [workspacePackage.manifest.name] : []),
  ),
);
const WORKSPACE_DOCKET_PACKAGE_NAMES = new Set(
  WORKSPACE_PACKAGES.flatMap((workspacePackage) => {
    const packageName = workspacePackage.manifest.name;
    return packageName?.startsWith('@docket/') ? [packageName] : [];
  }),
);
const DOMAIN_PACKAGES_BY_DIRECTORY = new Map(
  WORKSPACE_PACKAGES.filter((workspacePackage) => workspacePackage.group === 'domains').map(
    (workspacePackage) => [workspacePackage.directory, workspacePackage],
  ),
);
const DOMAIN_REGISTRATIONS_BY_PACKAGE_NAME = new Map(
  (JSON.parse(readFileSync(DOMAIN_REGISTRY_PATH, 'utf8')) as DomainRegistry).domains.map(
    (registration) => [registration.packageName, registration],
  ),
);

function isWithinDirectory(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
}

function domainDirectory(path: string): string | undefined {
  if (!isWithinDirectory(path, DOMAINS_DIRECTORY)) return undefined;
  const [domain] = path.slice(`${DOMAINS_DIRECTORY}/`.length).split('/');
  return domain ? resolve(DOMAINS_DIRECTORY, domain) : undefined;
}

function workspacePackageRoot(specifier: string): string | undefined {
  const packageName = /^(@docket\/[^/]+)(?:\/|$)/.exec(specifier)?.[1];
  return packageName && WORKSPACE_DOCKET_PACKAGE_NAMES.has(packageName) ? packageName : undefined;
}

function workspacePackageForSource(filePath: string) {
  return WORKSPACE_PACKAGES.find((workspacePackage) =>
    isWithinDirectory(filePath, resolve(workspacePackage.directory, 'src')),
  );
}

function workspacePackageForPath(filePath: string) {
  return WORKSPACE_PACKAGES.filter((workspacePackage) =>
    isWithinDirectory(filePath, workspacePackage.directory),
  ).sort((left, right) => right.directory.length - left.directory.length)[0];
}

function deliveryPackageForSource(filePath: string) {
  const runtime = deliveryRuntimeForSource(filePath);
  return runtime
    ? WORKSPACE_PACKAGES.find(
        (workspacePackage) => workspacePackage.directory === DELIVERY_APP_DIRECTORIES[runtime],
      )
    : undefined;
}

function guardedPackageForSource(filePath: string) {
  const workspacePackage =
    workspacePackageForSource(filePath) ?? deliveryPackageForSource(filePath);
  if (!workspacePackage) return undefined;
  const isGuarded =
    workspacePackage.group === 'domains' || deliveryRuntimeForSource(filePath) !== undefined;
  return isGuarded ? workspacePackage : undefined;
}

function isTestSource(filePath: string): boolean {
  const testFile = /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath);
  const workspacePackage = workspacePackageForSource(filePath);
  if (workspacePackage) {
    return testFile || isSourceLocalTestPath(filePath, resolve(workspacePackage.directory, 'src'));
  }
  return testFile || /(?:^|\/)(?:__tests__|test|tests)(?:\/|$)/.test(filePath);
}

function crossesWorkspaceSourceBoundary(filePath: string, resolvedSpecifier: string): boolean {
  const sourcePackage = guardedPackageForSource(filePath) ?? workspacePackageForSource(filePath);
  const targetPackage = workspacePackageForPath(resolvedSpecifier);

  return (
    sourcePackage !== undefined &&
    targetPackage !== undefined &&
    sourcePackage.directory !== targetPackage.directory
  );
}

function escapesGuardedSourceTree(filePath: string, resolvedSpecifier: string): boolean {
  const sourceDirectory = guardedSourceDirectory(filePath);
  return sourceDirectory !== undefined && !isWithinDirectory(resolvedSpecifier, sourceDirectory);
}

function guardedSourceDirectory(filePath: string): string | undefined {
  const workspacePackage = workspacePackageForSource(filePath);
  if (workspacePackage) return resolve(workspacePackage.directory, 'src');
  return deliveryPackageForSource(filePath)?.directory;
}

function resolvesInsideOwningDeliveryTree(filePath: string, resolvedSpecifier: string): boolean {
  const runtime = deliveryRuntimeForSource(filePath);
  return (
    runtime !== undefined && isWithinDirectory(resolvedSpecifier, DELIVERY_APP_DIRECTORIES[runtime])
  );
}

function isResolvedWorkspaceTestSource(filePath: string): boolean {
  const workspacePackage = workspacePackageForPath(filePath);
  return workspacePackage !== undefined && isTestSource(filePath);
}

function deliveryRuntimeForSource(filePath: string): DeliveryAppRuntime | undefined {
  return DELIVERY_APP_RUNTIMES.find((runtime) => {
    const directory = DELIVERY_APP_DIRECTORIES[runtime];
    const workspacePackage = WORKSPACE_PACKAGES.find(
      (candidate) => candidate.directory === directory,
    );
    return (
      isWithinDirectory(filePath, DELIVERY_APP_SOURCE_DIRECTORIES[runtime]) ||
      (workspacePackage !== undefined &&
        isPackageProductionEntrypointFile(filePath, directory, workspacePackage.manifest))
    );
  });
}

/** Collect every production delivery entrypoint that lives outside an app's `src` tree. */
function collectDeliveryProductionEntrypointFiles(): string[] {
  return DELIVERY_APP_RUNTIMES.flatMap((runtime) => {
    const directory = DELIVERY_APP_DIRECTORIES[runtime];
    const workspacePackage = WORKSPACE_PACKAGES.find(
      (candidate) => candidate.directory === directory,
    );
    return workspacePackage
      ? collectPackageProductionEntrypointFiles(directory, workspacePackage.manifest)
      : [];
  });
}

function hasUnsupportedDomainDeployableRuntime(filePath: string, specifier: string): boolean {
  const runtime = deliveryRuntimeForSource(filePath);
  const packageName = workspacePackageRoot(specifier);
  const registration = packageName
    ? DOMAIN_REGISTRATIONS_BY_PACKAGE_NAME.get(packageName)
    : undefined;

  return (
    runtime !== undefined &&
    registration !== undefined &&
    !registration.supportedDeployableRuntimes.includes(runtime)
  );
}

function isGuardedModuleLoaderSource(filePath: string): boolean {
  return (
    domainDirectory(filePath) !== undefined || deliveryRuntimeForSource(filePath) !== undefined
  );
}

function isDeclaredDomainRuntimeDependency(filePath: string, packageName: string): boolean {
  const sourceDomain = domainDirectory(filePath);
  const deliveryRuntime = deliveryRuntimeForSource(filePath);
  if (!sourceDomain && deliveryRuntime === undefined) return true;

  const sourcePackage = sourceDomain
    ? DOMAIN_PACKAGES_BY_DIRECTORY.get(sourceDomain)
    : deliveryPackageForSource(filePath);
  const declaredDependencies = sourcePackage?.manifest.dependencies ?? {};
  if (!Object.prototype.hasOwnProperty.call(declaredDependencies, packageName)) return false;

  if (!sourceDomain) return true;
  const registration = sourcePackage?.manifest.name
    ? DOMAIN_REGISTRATIONS_BY_PACKAGE_NAME.get(sourcePackage.manifest.name)
    : undefined;

  return registration?.allowedRuntimeDependencies.includes(packageName) === true;
}

/** Normalize suffix-marked specifiers without weakening opaque `#` package-import aliases. */
function matchingModuleSpecifier(specifier: string): string {
  return specifier.startsWith('#') ? specifier : specifier.replace(/[?#].*$/, '');
}

function resolvedModuleSpecifier(filePath: string, specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return resolve(dirname(filePath), specifier);
  }
  const runtime = deliveryRuntimeForSource(filePath);
  if (
    runtime !== undefined &&
    SOURCE_ROOT_ALIASED_DELIVERY_RUNTIMES.has(runtime) &&
    specifier.startsWith('@/')
  ) {
    return resolve(DELIVERY_APP_SOURCE_DIRECTORIES[runtime], specifier.slice(2));
  }
  return undefined;
}

function ruleForSpecifier(filePath: string, specifier: string): DomainImportRule | undefined {
  const matchingSpecifier = matchingModuleSpecifier(specifier);
  const resolvedSpecifier = resolvedModuleSpecifier(filePath, matchingSpecifier);

  if (resolvedSpecifier && crossesWorkspaceSourceBoundary(filePath, resolvedSpecifier)) {
    return 'workspace-private';
  }
  if (resolvedSpecifier && escapesGuardedSourceTree(filePath, resolvedSpecifier)) {
    return 'source-escape';
  }
  if (resolvedSpecifier && isResolvedWorkspaceTestSource(resolvedSpecifier)) {
    return 'testing';
  }
  if (
    matchingSpecifier.startsWith('apps/') ||
    (resolvedSpecifier &&
      isWithinDirectory(resolvedSpecifier, APPS_DIRECTORY) &&
      !resolvesInsideOwningDeliveryTree(filePath, resolvedSpecifier))
  ) {
    return 'app-source';
  }
  const privateDomainSpecifier = DOMAIN_SOURCE_SPECIFIER.exec(matchingSpecifier);
  if (privateDomainSpecifier?.[1] && DOMAIN_PACKAGE_NAMES.has(privateDomainSpecifier[1])) {
    return 'domain-private';
  }
  if (resolvedSpecifier) {
    const sourceDomain = domainDirectory(filePath);
    const targetDomain = domainDirectory(resolvedSpecifier);
    if (sourceDomain && targetDomain && sourceDomain !== targetDomain) return 'domain-private';
  }
  if (guardedPackageForSource(filePath) && matchingSpecifier.startsWith('#')) {
    return 'package-import-alias';
  }
  if (APP_DELIVERY_SPECIFIER.test(matchingSpecifier)) return 'app-delivery';
  if (USER_INTERFACE_SPECIFIER.test(matchingSpecifier)) return 'user-interface';
  if (ENVIRONMENT_SPECIFIER.test(matchingSpecifier)) return 'environment';
  if (GENERIC_TYPES_SPECIFIER.test(matchingSpecifier)) return 'generic-types';
  const workspacePackage = workspacePackageRoot(matchingSpecifier);
  if (
    hasConventionalTestDirectory(matchingSpecifier) ||
    TESTING_SUBPATH.test(matchingSpecifier) ||
    (workspacePackage && TEST_FILE_SUBPATH.test(matchingSpecifier))
  ) {
    return 'testing';
  }
  if (hasUnsupportedDomainDeployableRuntime(filePath, matchingSpecifier)) {
    return 'unsupported-deployable-runtime';
  }
  if (workspacePackage && !isDeclaredDomainRuntimeDependency(filePath, workspacePackage)) {
    return 'workspace-dependency';
  }
  return undefined;
}

function dynamicOrRequireModuleLoadArgument(node: ts.Node): ts.Expression | undefined {
  if (!ts.isCallExpression(node) || node.arguments.length === 0) return undefined;
  const [argument] = node.arguments;
  if (!argument) return undefined;
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
  return isDynamicImport || isRequireCall ? argument : undefined;
}

/** Remove TypeScript-only wrappers before classifying a runtime expression. */
function unwrapTransparentExpression(expression: ts.Expression): ts.Expression {
  let unwrapped = expression;
  while (
    ts.isParenthesizedExpression(unwrapped) ||
    ts.isAsExpression(unwrapped) ||
    ts.isTypeAssertionExpression(unwrapped) ||
    ts.isNonNullExpression(unwrapped) ||
    ts.isSatisfiesExpression(unwrapped)
  ) {
    unwrapped = unwrapped.expression;
  }
  return unwrapped;
}

function staticStringLiteralText(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapTransparentExpression(expression);
  return ts.isStringLiteralLike(unwrapped) ? unwrapped.text : undefined;
}

function globalObjectSpecifier(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapTransparentExpression(expression);
  return ts.isIdentifier(unwrapped) &&
    (unwrapped.text === 'global' || unwrapped.text === 'globalThis')
    ? unwrapped.text
    : undefined;
}

function requiredProcessSpecifier(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapTransparentExpression(expression);
  if (!ts.isCallExpression(unwrapped)) return undefined;
  const callee = unwrapTransparentExpression(unwrapped.expression);
  if (!ts.isIdentifier(callee) || callee.text !== 'require') return undefined;
  const [moduleSpecifier] = unwrapped.arguments;
  const processSpecifier = moduleSpecifier && staticStringLiteralText(moduleSpecifier);
  return processSpecifier &&
    PROCESS_MODULE_SPECIFIERS.has(matchingModuleSpecifier(processSpecifier))
    ? `require(${processSpecifier})`
    : undefined;
}

function processGlobalSpecifier(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapTransparentExpression(expression);
  if (ts.isIdentifier(unwrapped) && unwrapped.text === 'process') return 'process';
  if (ts.isPropertyAccessExpression(unwrapped)) {
    const globalObject = globalObjectSpecifier(unwrapped.expression);
    if (unwrapped.name.text === 'process' && globalObject) return `${globalObject}.process`;
  }
  if (ts.isElementAccessExpression(unwrapped)) {
    const globalObject = globalObjectSpecifier(unwrapped.expression);
    if (staticStringLiteralText(unwrapped.argumentExpression) === 'process' && globalObject) {
      return `${globalObject}.process`;
    }
  }
  return requiredProcessSpecifier(unwrapped);
}

function processMethodReceiverSpecifier(
  expression: ts.Expression,
  methodName: string,
): string | undefined {
  const unwrapped = unwrapTransparentExpression(expression);
  if (ts.isPropertyAccessExpression(unwrapped)) {
    return unwrapped.name.text === methodName
      ? processGlobalSpecifier(unwrapped.expression)
      : undefined;
  }
  return ts.isElementAccessExpression(unwrapped) &&
    staticStringLiteralText(unwrapped.argumentExpression) === methodName
    ? processGlobalSpecifier(unwrapped.expression)
    : undefined;
}

/** Detect Node's direct factory for a CommonJS loader without allowing a runtime alias. */
function processBuiltinModuleLoaderSpecifier(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  const processSpecifier = processMethodReceiverSpecifier(node.expression, 'getBuiltinModule');
  if (!processSpecifier) return undefined;
  const [moduleSpecifier] = node.arguments;
  const builtinSpecifier = moduleSpecifier && staticStringLiteralText(moduleSpecifier);
  return builtinSpecifier && isModuleLoaderSpecifier(matchingModuleSpecifier(builtinSpecifier))
    ? `${processSpecifier}.getBuiltinModule(${builtinSpecifier})`
    : undefined;
}

/** Block the one named node:process import that fabricates a runtime module loader. */
function nodeProcessLoaderFactoryImport(node: ts.Node): ts.ImportSpecifier | undefined {
  if (
    !ts.isImportDeclaration(node) ||
    !node.importClause ||
    node.importClause.phaseModifier === ts.SyntaxKind.TypeKeyword ||
    !ts.isStringLiteralLike(node.moduleSpecifier) ||
    !PROCESS_MODULE_SPECIFIERS.has(matchingModuleSpecifier(node.moduleSpecifier.text))
  ) {
    return undefined;
  }
  const namedBindings = node.importClause.namedBindings;
  if (!namedBindings || !ts.isNamedImports(namedBindings)) return undefined;
  return namedBindings.elements.find(
    (binding) =>
      !binding.isTypeOnly && (binding.propertyName ?? binding.name).text === 'getBuiltinModule',
  );
}

/** Track only default and namespace process bindings so ordinary process APIs remain usable. */
function processModuleImportAliases(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const aliases = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      statement.importClause.phaseModifier === ts.SyntaxKind.TypeKeyword ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !PROCESS_MODULE_SPECIFIERS.has(matchingModuleSpecifier(statement.moduleSpecifier.text))
    ) {
      continue;
    }
    if (statement.importClause.name) aliases.add(statement.importClause.name.text);
    const namedBindings = statement.importClause.namedBindings;
    if (namedBindings && ts.isNamespaceImport(namedBindings)) aliases.add(namedBindings.name.text);
  }
  return aliases;
}

/**
 * Track one direct alias from a recognized process origin, not a transitive alias chain.
 *
 * The policy is intentionally bounded: `const p = process` and `p = globalThis.process` are
 * equivalent loader origins, while `const q = p` remains outside this syntax-only analysis.
 */
function processAliases(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const importedAliases = processModuleImportAliases(sourceFile);
  const aliases = new Set(importedAliases);
  const isDirectProcessOrigin = (expression: ts.Expression): boolean => {
    const unwrapped = unwrapTransparentExpression(expression);
    return (
      processGlobalSpecifier(unwrapped) !== undefined ||
      (ts.isIdentifier(unwrapped) && importedAliases.has(unwrapped.text))
    );
  };

  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (isDirectProcessOrigin(node.initializer)) aliases.add(node.name.text);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      isDirectProcessOrigin(node.right)
    ) {
      aliases.add(node.left.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return aliases;
}

function processModuleAliasLoaderSpecifier(
  node: ts.Node,
  aliases: ReadonlySet<string>,
): string | undefined {
  const receiver =
    ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
      ? unwrapTransparentExpression(node.expression)
      : undefined;
  const propertyName = ts.isPropertyAccessExpression(node)
    ? node.name.text
    : ts.isElementAccessExpression(node)
      ? staticStringLiteralText(node.argumentExpression)
      : undefined;
  return receiver &&
    ts.isIdentifier(receiver) &&
    aliases.has(receiver.text) &&
    propertyName === 'getBuiltinModule'
    ? `${receiver.text}.getBuiltinModule`
    : undefined;
}

interface ModuleLoaderDestructuringAccess {
  readonly binding: ts.BindingElement;
  readonly specifier: string;
}

function bindingPropertyName(binding: ts.BindingElement): string | undefined {
  const propertyName = binding.propertyName ?? binding.name;
  if (ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName)) {
    return propertyName.text;
  }
  return ts.isComputedPropertyName(propertyName)
    ? staticStringLiteralText(propertyName.expression)
    : undefined;
}

function moduleLoaderDestructuringAccessForPattern(
  pattern: ts.ObjectBindingPattern,
  initializer: ts.Expression | undefined,
): ModuleLoaderDestructuringAccess | undefined {
  if (!initializer) return undefined;
  const specifier = moduleLoaderSpecifierForProperty(initializer, 'require');
  const binding = pattern.elements.find((element) => bindingPropertyName(element) === 'require');

  return specifier && binding ? { binding, specifier } : undefined;
}

function moduleLoaderDestructuringAccess(
  node: ts.Node,
): ModuleLoaderDestructuringAccess | undefined {
  if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
    return moduleLoaderDestructuringAccessForPattern(node.name, node.initializer);
  }
  if (ts.isParameter(node) && ts.isObjectBindingPattern(node.name)) {
    return moduleLoaderDestructuringAccessForPattern(node.name, node.initializer);
  }
  return undefined;
}

interface ModuleLoaderAssignmentAccess {
  readonly node: ts.Node;
  readonly specifier: string;
}

function moduleLoaderGlobalSpecifier(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapTransparentExpression(expression);

  return ts.isIdentifier(unwrapped) &&
    (unwrapped.text === 'module' || unwrapped.text === 'globalThis')
    ? unwrapped.text
    : undefined;
}

function moduleLoaderSpecifierForProperty(
  receiver: ts.Expression,
  propertyName: string,
): string | undefined {
  const processSpecifier = processGlobalSpecifier(receiver);
  if (propertyName === 'mainModule' && processSpecifier) return `${processSpecifier}.mainModule`;
  const receiverSpecifier = moduleLoaderGlobalSpecifier(receiver);
  return propertyName === 'require' && receiverSpecifier
    ? `${receiverSpecifier}.require`
    : undefined;
}

function moduleLoaderPropertySpecifier(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return moduleLoaderSpecifierForProperty(node.expression, node.name.text);
  }
  if (ts.isElementAccessExpression(node)) {
    const propertyName = staticStringLiteralText(node.argumentExpression);
    return propertyName
      ? moduleLoaderSpecifierForProperty(node.expression, propertyName)
      : undefined;
  }
  return undefined;
}

function propertyAssignmentName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (!ts.isPropertyAssignment(property)) return undefined;
  if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) {
    return property.name.text;
  }
  return ts.isComputedPropertyName(property.name)
    ? staticStringLiteralText(property.name.expression)
    : undefined;
}

function moduleLoaderAssignmentAccess(node: ts.Node): ModuleLoaderAssignmentAccess | undefined {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    const globalSpecifier = node.initializer && moduleLoaderGlobalSpecifier(node.initializer);
    return globalSpecifier ? { node: node.name, specifier: globalSpecifier } : undefined;
  }
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
    return undefined;
  }
  const globalSpecifier = moduleLoaderGlobalSpecifier(node.right);
  if (globalSpecifier && ts.isIdentifier(node.left)) {
    return { node: node.left, specifier: globalSpecifier };
  }
  if (!ts.isObjectLiteralExpression(node.left)) return undefined;
  const specifier = moduleLoaderSpecifierForProperty(node.right, 'require');
  const property = node.left.properties.find(
    (candidate) => propertyAssignmentName(candidate) === 'require',
  );

  return specifier && property ? { node: property, specifier } : undefined;
}

function isModuleLoaderSpecifier(specifier: string): boolean {
  return MODULE_LOADER_SPECIFIERS.has(specifier);
}

function isRequireIdentifier(node: ts.Node | undefined): node is ts.Identifier {
  return Boolean(node && ts.isIdentifier(node) && node.text === 'require');
}

function isNodeName(node: ts.Identifier, parent: ts.Node): boolean {
  return (parent as { readonly name?: ts.Node }).name === node;
}

function isRequireDeclarationOrPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;

  if (ts.isBindingElement(parent) || ts.isImportSpecifier(parent)) {
    return parent.name === node || parent.propertyName === node;
  }
  if (ts.isQualifiedName(parent)) return parent.right === node;
  if (ts.isTypeReferenceNode(parent)) return parent.typeName === node;

  return (
    isNodeName(node, parent) &&
    (ts.isDeclarationStatement(parent) ||
      ts.isClassExpression(parent) ||
      ts.isEnumMember(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isImportClause(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isParameter(parent) ||
      ts.isPropertyAccessExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isTypeParameterDeclaration(parent) ||
      ts.isVariableDeclaration(parent))
  );
}

function isDirectRequireCallCallee(node: ts.Identifier): boolean {
  return ts.isCallExpression(node.parent) && node.parent.expression === node;
}

/**
 * Treat lexical `require` values as reserved loader aliases in guarded source.
 *
 * Without a type checker, a value use cannot be distinguished from the CommonJS loader, so only
 * direct module calls and syntactic declaration/property/type names are permitted.
 */
function isRequireValueReference(node: ts.Node): node is ts.Identifier {
  return (
    isRequireIdentifier(node) &&
    !isDirectRequireCallCallee(node) &&
    !ts.isExternalModuleReference(node.parent) &&
    !isRequireDeclarationOrPropertyName(node)
  );
}

function nonliteralModuleLoadArgument(node: ts.Node): ts.Expression | undefined {
  const argument = dynamicOrRequireModuleLoadArgument(node);
  return argument && !ts.isStringLiteralLike(argument) ? argument : undefined;
}

function importSpecifier(node: ts.Node): ts.StringLiteralLike | undefined {
  if (ts.isImportTypeNode(node)) {
    return ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)
      ? node.argument.literal
      : undefined;
  }
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
      ? node.moduleSpecifier
      : undefined;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return ts.isStringLiteralLike(node.moduleReference.expression)
      ? node.moduleReference.expression
      : undefined;
  }
  const argument = dynamicOrRequireModuleLoadArgument(node);
  return argument && ts.isStringLiteralLike(argument) ? argument : undefined;
}

function isApiRpcTransportContractTypePosition(node: ts.Node): boolean {
  return (
    ts.isImportTypeNode(node) ||
    (ts.isImportDeclaration(node) &&
      (node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
        hasOnlyTypeNamedSpecifiers(node))) ||
    (ts.isExportDeclaration(node) && (node.isTypeOnly || hasOnlyTypeNamedSpecifiers(node)))
  );
}

function hasOnlyTypeNamedSpecifiers(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(node)) {
    const namedBindings = node.importClause?.namedBindings;
    return (
      node.importClause?.name === undefined &&
      namedBindings !== undefined &&
      ts.isNamedImports(namedBindings) &&
      namedBindings.elements.length > 0 &&
      namedBindings.elements.every((specifier) => specifier.isTypeOnly)
    );
  }

  return (
    node.exportClause !== undefined &&
    ts.isNamedExports(node.exportClause) &&
    node.exportClause.elements.length > 0 &&
    node.exportClause.elements.every((specifier) => specifier.isTypeOnly)
  );
}

function isPermittedApiRpcTransportContract(
  filePath: string,
  node: ts.Node,
  specifier: string,
): boolean {
  return (
    deliveryRuntimeForSource(filePath) !== undefined &&
    specifier === API_RPC_TRANSPORT_CONTRACT_SPECIFIER &&
    isApiRpcTransportContractTypePosition(node)
  );
}

function scriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:cjs|js|mjs)$/.test(filePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function scanDomainImportPolicy(
  filePath: string,
  sourceText = readFileSync(filePath, 'utf8'),
): DomainImportViolation[] {
  if (isTestSource(filePath)) return [];
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(filePath),
  );
  const violations: DomainImportViolation[] = [];
  const guardedModuleLoaderSource = isGuardedModuleLoaderSource(filePath);
  const processModuleAliases = processAliases(sourceFile);

  function recordViolation(node: ts.Node, rule: DomainImportRule, specifier: string): void {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push({
      column: location.character + 1,
      file: relativeToWorkspaceRoot(filePath),
      line: location.line + 1,
      rule,
      specifier,
    });
  }

  function visit(node: ts.Node): void {
    const moduleLoaderProperty = moduleLoaderPropertySpecifier(node);
    const processBuiltinModuleLoader = processBuiltinModuleLoaderSpecifier(node);
    const nodeProcessLoaderImport = nodeProcessLoaderFactoryImport(node);
    const processModuleAliasLoader = processModuleAliasLoaderSpecifier(node, processModuleAliases);
    const moduleLoaderDestructuring = moduleLoaderDestructuringAccess(node);
    const moduleLoaderAssignment = moduleLoaderAssignmentAccess(node);
    const requireValue = isRequireValueReference(node);
    if (guardedModuleLoaderSource && moduleLoaderProperty) {
      recordViolation(node, 'module-loader-alias', moduleLoaderProperty);
    } else if (guardedModuleLoaderSource && processBuiltinModuleLoader) {
      recordViolation(node, 'module-loader-alias', processBuiltinModuleLoader);
    } else if (guardedModuleLoaderSource && nodeProcessLoaderImport) {
      recordViolation(
        nodeProcessLoaderImport,
        'module-loader-alias',
        'node:process.getBuiltinModule',
      );
    } else if (guardedModuleLoaderSource && processModuleAliasLoader) {
      recordViolation(node, 'module-loader-alias', processModuleAliasLoader);
    } else if (guardedModuleLoaderSource && moduleLoaderDestructuring) {
      recordViolation(
        moduleLoaderDestructuring.binding,
        'module-loader-alias',
        moduleLoaderDestructuring.specifier,
      );
    } else if (guardedModuleLoaderSource && moduleLoaderAssignment) {
      recordViolation(
        moduleLoaderAssignment.node,
        'module-loader-alias',
        moduleLoaderAssignment.specifier,
      );
    } else if (guardedModuleLoaderSource && requireValue) {
      recordViolation(node, 'module-loader-alias', 'require');
    } else {
      const moduleSpecifier = importSpecifier(node);
      if (moduleSpecifier) {
        if (
          guardedModuleLoaderSource &&
          isModuleLoaderSpecifier(matchingModuleSpecifier(moduleSpecifier.text))
        ) {
          recordViolation(moduleSpecifier, 'module-loader-alias', moduleSpecifier.text);
        } else if (!isPermittedApiRpcTransportContract(filePath, node, moduleSpecifier.text)) {
          const rule = ruleForSpecifier(filePath, moduleSpecifier.text);
          if (rule) {
            recordViolation(moduleSpecifier, rule, moduleSpecifier.text);
          }
        }
      }
      const nonliteralSpecifier = nonliteralModuleLoadArgument(node);
      if (guardedModuleLoaderSource && nonliteralSpecifier) {
        recordViolation(
          nonliteralSpecifier,
          'dynamic-module-specifier',
          nonliteralSpecifier.getText(sourceFile),
        );
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function scanDeliveryDomainRuntimePolicy(
  filePath: string,
  sourceText: string,
): DomainImportViolation[] {
  return scanDomainImportPolicy(filePath, sourceText).filter(
    (violation) => violation.rule === 'unsupported-deployable-runtime',
  );
}

const DELIVERY_SOURCE_RULES = new Set<DomainImportRule>([
  'app-delivery',
  'app-source',
  'domain-private',
  'dynamic-module-specifier',
  'module-loader-alias',
  'package-import-alias',
  'source-escape',
  'testing',
  'unsupported-deployable-runtime',
  'workspace-dependency',
  'workspace-private',
]);

function scanDeliveryDomainImportPolicy(
  filePath: string,
  sourceText: string,
): DomainImportViolation[] {
  return scanDomainImportPolicy(filePath, sourceText).filter((violation) =>
    DELIVERY_SOURCE_RULES.has(violation.rule),
  );
}

function formatDomainImportViolations(violations: readonly DomainImportViolation[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.file}:${violation.line}:${violation.column} ` +
        `[${violation.rule}] ${violation.specifier}`,
    )
    .join('\n');
}

const FIXTURE_PATH = resolve(WORKSPACE_ROOT, 'domains/work/src/example.ts');
const BILLING_FIXTURE_PATH = resolve(WORKSPACE_ROOT, 'domains/billing/src/example.ts');
const BILLING_CONTRACTS_FIXTURE_PATH = resolve(WORKSPACE_ROOT, 'domains/billing/src/contracts.ts');
const AUTOMATION_CONTRACTS_FIXTURE_PATH = resolve(
  WORKSPACE_ROOT,
  'domains/automation/src/contracts.ts',
);
const AUTOMATION_SOURCE_FILES = [
  resolve(WORKSPACE_ROOT, 'domains/automation/src/contracts.ts'),
  resolve(WORKSPACE_ROOT, 'domains/automation/src/evaluation.ts'),
] as const;
const API_FIXTURE_PATH = resolve(WORKSPACE_ROOT, 'apps/api/src/example.ts');
const WEB_FIXTURE_PATH = resolve(WORKSPACE_ROOT, 'apps/web/src/example.ts');
const ADMIN_FIXTURE_PATH = resolve(WORKSPACE_ROOT, 'apps/admin/src/example.ts');
const RUNNER_FIXTURE_PATH = resolve(WORKSPACE_ROOT, 'apps/runner/src/example.ts');
const DESKTOP_FIXTURE_PATH = resolve(WORKSPACE_ROOT, 'apps/desktop/src/example.ts');
const WEB_BUILD_CONFIG_FIXTURE_PATH = resolve(WORKSPACE_ROOT, 'apps/web/next.config.ts');
const WEB_BUILD_SCRIPT_FIXTURE_PATH = resolve(
  WORKSPACE_ROOT,
  'apps/web/scripts/generate-offline-routes.ts',
);
const PACKAGE_TEST_FIXTURE_PATH = resolve(WORKSPACE_ROOT, 'domains/work/tests/example.ts');
const TEST_NAMED_PRODUCTION_FIXTURE_PATH = resolve(
  WORKSPACE_ROOT,
  'domains/work/src/testing/example.ts',
);
const SOURCE_LOCAL_TEST_FIXTURE_PATHS = ['__tests__', 'test', 'tests'].flatMap((directory) => [
  resolve(WORKSPACE_ROOT, `domains/work/src/${directory}/example.ts`),
  resolve(WORKSPACE_ROOT, `domains/work/src/nested/${directory}/example.ts`),
]);
const MODULE_FORMAT_FIXTURE_PATHS = ['mts', 'cts', 'js', 'mjs', 'cjs'].map((extension) =>
  resolve(WORKSPACE_ROOT, `domains/work/src/example.${extension}`),
);
const CJS_FIXTURE_PATH = resolve(WORKSPACE_ROOT, 'domains/work/src/example.cjs');

describe('domain import policy', () => {
  it('rejects delivery, presentation, environment, test-only, and undeclared workspace dependencies', () => {
    const fixture = `
      import type { AppType } from '../../../apps/api/src/index';
      export { workRoutes } from '@docket/api/routes/work';
      import { Button } from '@docket/ui';
      const config = await import('@docket/env/server');
      import type { LegacyType } from '@docket/types';
      const fixtures = require('@docket/notifications/testing');
      import { privateProtocol } from '@docket/athena/src/execution-protocol';
      import { relativePrivateProtocol } from '../../athena/src/execution-protocol';
      import { executionMessage } from '@docket/athena/execution-protocol';
      import { database } from '@docket/db';
      export * from '@docket/db/schema';
      const dynamicDatabase = await import('@docket/db/query');
      const requiredDatabase = require('@docket/db/client');
      const documentation = "import { Button } from '@docket/ui'";
      // import { env } from '@docket/env';
    `;

    expect(scanDomainImportPolicy(FIXTURE_PATH, fixture)).toEqual([
      expect.objectContaining({
        rule: 'workspace-private',
        specifier: '../../../apps/api/src/index',
      }),
      expect.objectContaining({
        rule: 'app-delivery',
        specifier: '@docket/api/routes/work',
      }),
      expect.objectContaining({ rule: 'user-interface', specifier: '@docket/ui' }),
      expect.objectContaining({ rule: 'environment', specifier: '@docket/env/server' }),
      expect.objectContaining({ rule: 'generic-types', specifier: '@docket/types' }),
      expect.objectContaining({ rule: 'testing', specifier: '@docket/notifications/testing' }),
      expect.objectContaining({
        rule: 'domain-private',
        specifier: '@docket/athena/src/execution-protocol',
      }),
      expect.objectContaining({
        rule: 'workspace-private',
        specifier: '../../athena/src/execution-protocol',
      }),
      expect.objectContaining({
        rule: 'workspace-dependency',
        specifier: '@docket/athena/execution-protocol',
      }),
      expect.objectContaining({ rule: 'workspace-dependency', specifier: '@docket/db' }),
      expect.objectContaining({ rule: 'workspace-dependency', specifier: '@docket/db/schema' }),
      expect.objectContaining({ rule: 'workspace-dependency', specifier: '@docket/db/query' }),
      expect.objectContaining({ rule: 'workspace-dependency', specifier: '@docket/db/client' }),
    ]);
  });

  it('allows a workspace package declared by the domain registry and manifest', () => {
    const source = `
      import { database } from '@docket/db';
      export * from '@docket/db/schema';
      const dynamicDatabase = await import('@docket/db/query');
      const requiredDatabase = require('@docket/db/client');
    `;

    expect(scanDomainImportPolicy(BILLING_FIXTURE_PATH, source)).toEqual([]);
  });

  it('rejects relative imports that cross a workspace package source boundary', () => {
    const databaseSource = `import { database } from '../../../packages/db/src/client';`;
    const relaySource = `import { relay } from '../../../services/discord-relay/src/relay';`;
    const sameDomainSource = `import { localRule } from './local-rule';`;

    expect(scanDomainImportPolicy(BILLING_FIXTURE_PATH, databaseSource)).toEqual([
      expect.objectContaining({
        rule: 'workspace-private',
        specifier: '../../../packages/db/src/client',
      }),
    ]);
    expect(scanDomainImportPolicy(BILLING_FIXTURE_PATH, relaySource)).toEqual([
      expect.objectContaining({
        rule: 'workspace-private',
        specifier: '../../../services/discord-relay/src/relay',
      }),
    ]);
    expect(scanDomainImportPolicy(BILLING_FIXTURE_PATH, sameDomainSource)).toEqual([]);
  });

  it('rejects domain source relative imports that escape their own src tree', () => {
    const source = `import { runtimePrivate } from '../runtime/private';`;

    expect(scanDomainImportPolicy(BILLING_CONTRACTS_FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'source-escape', specifier: '../runtime/private' }),
    ]);
  });

  it('rejects local and nested test-directory imports while allowing normal local source', () => {
    const source = `
      import { localFixture } from './__tests__/fixture';
      import { nestedFixture } from './adapters/__tests__/fixture';
      import { packageFixture } from '@docket/notifications/__tests__/fixture';
      import { normalSource } from './adapters/runtime';
    `;

    expect(scanDomainImportPolicy(FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'testing', specifier: './__tests__/fixture' }),
      expect.objectContaining({ rule: 'testing', specifier: './adapters/__tests__/fixture' }),
      expect.objectContaining({
        rule: 'testing',
        specifier: '@docket/notifications/__tests__/fixture',
      }),
    ]);
  });

  it('rejects package imports aliases from domain source across module-load forms', () => {
    const source = `
      import { privateContract } from '#private';
      export { privateContract as exportedPrivateContract } from '#private/export';
      type PrivateContract = import('#private/types').PrivateContract;
      const dynamicPrivateContract = await import('#private/dynamic');
      const requiredPrivateContract = require('#private/require');
      import PrivateContractAlias = require('#private/equal');
    `;

    expect(scanDomainImportPolicy(BILLING_FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'package-import-alias', specifier: '#private' }),
      expect.objectContaining({ rule: 'package-import-alias', specifier: '#private/export' }),
      expect.objectContaining({ rule: 'package-import-alias', specifier: '#private/types' }),
      expect.objectContaining({ rule: 'package-import-alias', specifier: '#private/dynamic' }),
      expect.objectContaining({ rule: 'package-import-alias', specifier: '#private/require' }),
      expect.objectContaining({ rule: 'package-import-alias', specifier: '#private/equal' }),
    ]);
  });

  it('rejects delivery relative imports into domain source trees, including API', () => {
    const source = `import { billingContract } from '../../../domains/billing/src/contracts';`;

    for (const filePath of [API_FIXTURE_PATH, WEB_FIXTURE_PATH]) {
      expect(scanDomainImportPolicy(filePath, source)).toEqual([
        expect.objectContaining({
          rule: 'workspace-private',
          specifier: '../../../domains/billing/src/contracts',
        }),
      ]);
    }
  });

  it('rejects delivery source escapes and opaque aliases while allowing normal local imports', () => {
    const source = `
      import { runtimePrivate } from '../runtime/private';
      import { privateAlias } from '#private';
      import { normalSource } from './adapters/runtime';
    `;

    expect(scanDeliveryDomainImportPolicy(API_FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'source-escape', specifier: '../runtime/private' }),
      expect.objectContaining({ rule: 'package-import-alias', specifier: '#private' }),
    ]);
  });

  it('resolves configured delivery source aliases before enforcing source boundaries', () => {
    const source = `
      import { runtimePrivate } from '@/../runtime/private';
      import { normalSource } from '@/adapters/runtime';
    `;

    for (const filePath of [WEB_FIXTURE_PATH, ADMIN_FIXTURE_PATH]) {
      expect(scanDeliveryDomainImportPolicy(filePath, source)).toEqual([
        expect.objectContaining({ rule: 'source-escape', specifier: '@/../runtime/private' }),
      ]);
    }
  });

  it('rejects delivery imports of test directories and test files while allowing normal local source', () => {
    const deliverySource = `
      import { localFixture } from './__tests__/fixture';
      import { nestedFixture } from './adapters/tests/fixture';
      import { testFile } from './adapters/runtime.test.ts';
      import { specFile } from './adapters/runtime.spec.ts';
      import { normalSource } from './adapters/runtime';
    `;

    expect(scanDeliveryDomainImportPolicy(WEB_FIXTURE_PATH, deliverySource)).toEqual([
      expect.objectContaining({ rule: 'testing', specifier: './__tests__/fixture' }),
      expect.objectContaining({ rule: 'testing', specifier: './adapters/tests/fixture' }),
      expect.objectContaining({ rule: 'testing', specifier: './adapters/runtime.test.ts' }),
      expect.objectContaining({ rule: 'testing', specifier: './adapters/runtime.spec.ts' }),
    ]);
  });

  it('rejects aliased and suffix-marked test files in guarded production source', () => {
    const deliverySource = `
      import { aliasTest } from '@/adapters/runtime.test.ts';
      import { queryTest } from './adapters/runtime.test.ts?raw';
      import { hashSpec } from './adapters/runtime.spec.ts#fixture';
      import { normalSource } from '@/adapters/runtime';
    `;
    const domainSource = `
      import { queryTest } from './adapters/runtime.test.ts?raw';
      import { hashSpec } from './adapters/runtime.spec.ts#fixture';
      import { normalSource } from './adapters/runtime';
    `;

    expect(scanDeliveryDomainImportPolicy(WEB_FIXTURE_PATH, deliverySource)).toEqual([
      expect.objectContaining({ rule: 'testing', specifier: '@/adapters/runtime.test.ts' }),
      expect.objectContaining({ rule: 'testing', specifier: './adapters/runtime.test.ts?raw' }),
      expect.objectContaining({ rule: 'testing', specifier: './adapters/runtime.spec.ts#fixture' }),
    ]);
    expect(scanDomainImportPolicy(FIXTURE_PATH, domainSource)).toEqual([
      expect.objectContaining({ rule: 'testing', specifier: './adapters/runtime.test.ts?raw' }),
      expect.objectContaining({ rule: 'testing', specifier: './adapters/runtime.spec.ts#fixture' }),
    ]);
  });

  it('rejects normalized bare package test-file subpaths in delivery source', () => {
    const source = `
      import { queryTest } from '@docket/billing/contracts.test.ts?raw';
      import { hashSpec } from '@docket/billing/contracts.spec.ts#fixture';
      import { normalContract } from '@docket/billing/contracts';
    `;

    expect(scanDeliveryDomainImportPolicy(API_FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({
        rule: 'testing',
        specifier: '@docket/billing/contracts.test.ts?raw',
      }),
      expect.objectContaining({
        rule: 'testing',
        specifier: '@docket/billing/contracts.spec.ts#fixture',
      }),
    ]);
  });

  it('normalizes package suffixes for policy matching while preserving diagnostic literals', () => {
    const domainSource = `
      import { normalApi } from '@docket/api';
      import { queryApi } from '@docket/api?raw';
      import { hashApi } from '@docket/api#raw';
      import { testFixture } from '@docket/notifications/__tests__/fixture?raw';
      import { privateAlias } from '#private?raw';
    `;
    const deliverySource = `import { billing } from '@docket/billing?raw';`;

    expect(scanDomainImportPolicy(FIXTURE_PATH, domainSource)).toEqual([
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/api' }),
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/api?raw' }),
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/api#raw' }),
      expect.objectContaining({
        rule: 'testing',
        specifier: '@docket/notifications/__tests__/fixture?raw',
      }),
      expect.objectContaining({ rule: 'package-import-alias', specifier: '#private?raw' }),
    ]);
    expect(scanDeliveryDomainImportPolicy(WEB_FIXTURE_PATH, deliverySource)).toEqual([
      expect.objectContaining({
        rule: 'unsupported-deployable-runtime',
        specifier: '@docket/billing?raw',
      }),
    ]);
  });

  it('allows the API-owned RPC transport contract only in delivery type positions', () => {
    const source = `
      import type { AppType } from '@docket/api/rpc-contract';
      import { type AppType as NamedAppType } from '@docket/api/rpc-contract';
      export type { AppType as ExportedAppType } from '@docket/api/rpc-contract';
      export { type AppType as NamedExportedAppType } from '@docket/api/rpc-contract';
      type ImportedAppType = import('@docket/api/rpc-contract').AppType;
    `;

    for (const filePath of [WEB_FIXTURE_PATH, ADMIN_FIXTURE_PATH]) {
      expect(scanDeliveryDomainImportPolicy(filePath, source)).toEqual([]);
    }
  });

  it('rejects the RPC transport contract outside delivery type positions', () => {
    const deliverySource = `
      import * as rpcContract from '@docket/api/rpc-contract';
      import { AppType as RuntimeAppType } from '@docket/api/rpc-contract';
      import { type AppType, runtimeContract } from '@docket/api/rpc-contract';
      import type { AppType } from '@docket/api/foo';
      const dynamicContract = await import('@docket/api/rpc-contract');
      const requiredContract = require('@docket/api/rpc-contract');
    `;
    const domainSource = `
      import type { AppType } from '@docket/api/rpc-contract';
    `;

    expect(scanDeliveryDomainImportPolicy(WEB_FIXTURE_PATH, deliverySource)).toEqual([
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/api/rpc-contract' }),
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/api/rpc-contract' }),
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/api/rpc-contract' }),
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/api/foo' }),
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/api/rpc-contract' }),
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/api/rpc-contract' }),
    ]);
    expect(scanDomainImportPolicy(FIXTURE_PATH, domainSource)).toEqual([
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/api/rpc-contract' }),
    ]);
  });

  it('rejects domain imports of relative test files while allowing normal local source', () => {
    const source = `
      import { testFile } from './adapters/runtime.test.ts';
      import { specFile } from './adapters/runtime.spec.ts';
      import { normalSource } from './adapters/runtime';
    `;

    expect(scanDomainImportPolicy(FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'testing', specifier: './adapters/runtime.test.ts' }),
      expect.objectContaining({ rule: 'testing', specifier: './adapters/runtime.spec.ts' }),
    ]);
  });

  it('rejects every delivery-app package root and subpath from domain source', () => {
    const source = `
      import { api } from '@docket/api';
      import { web } from '@docket/web/arbitrary';
      import { admin } from '@docket/admin/src/arbitrary';
      import { runner } from '@docket/runner/arbitrary';
    `;

    expect(scanDomainImportPolicy(FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/api' }),
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/web/arbitrary' }),
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/admin/src/arbitrary' }),
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/runner/arbitrary' }),
    ]);
  });

  it('rejects delivery app root and source imports while allowing local app source', () => {
    const source = `
      import { admin } from '@docket/admin';
      import { privateAdmin } from '@docket/admin/src/private';
      import { directPrivateAdmin } from 'apps/admin/src/private';
      import { normalLocalSource } from './adapters/runtime';
    `;

    expect(scanDeliveryDomainImportPolicy(WEB_FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/admin' }),
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/admin/src/private' }),
      expect.objectContaining({ rule: 'app-source', specifier: 'apps/admin/src/private' }),
    ]);
  });

  it('rejects an undeclared ImportTypeNode workspace subpath', () => {
    const source = `type Db = import('@docket/db/query').Database;`;

    expect(scanDomainImportPolicy(FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'workspace-dependency', specifier: '@docket/db/query' }),
    ]);
    expect(scanDomainImportPolicy(BILLING_FIXTURE_PATH, source)).toEqual([]);
  });

  it('allows Billing imports from API delivery source', () => {
    const source = `import { billingContract } from '@docket/billing/contracts';`;

    expect(scanDeliveryDomainRuntimePolicy(API_FIXTURE_PATH, source)).toEqual([]);
  });

  it('rejects Billing imports from Web, Admin, and Runner delivery sources', () => {
    const source = `import { billingContract } from '@docket/billing/contracts';`;

    for (const filePath of [WEB_FIXTURE_PATH, ADMIN_FIXTURE_PATH, RUNNER_FIXTURE_PATH]) {
      expect(scanDeliveryDomainRuntimePolicy(filePath, source)).toEqual([
        expect.objectContaining({
          rule: 'unsupported-deployable-runtime',
          specifier: '@docket/billing/contracts',
        }),
      ]);
    }
  });

  it('requires every delivery runtime to declare supported Automation imports in its manifest', () => {
    const source = `import { AutomationRule } from '@docket/automation/contracts';`;

    for (const filePath of [API_FIXTURE_PATH, WEB_FIXTURE_PATH]) {
      expect(scanDeliveryDomainImportPolicy(filePath, source)).toEqual([]);
    }
    for (const filePath of [ADMIN_FIXTURE_PATH, RUNNER_FIXTURE_PATH, DESKTOP_FIXTURE_PATH]) {
      expect(scanDeliveryDomainImportPolicy(filePath, source)).toEqual([
        expect.objectContaining({
          rule: 'workspace-dependency',
          specifier: '@docket/automation/contracts',
        }),
      ]);
    }
  });

  it('applies runtime-registry enforcement to a future desktop production source', () => {
    const source = `import { billingContract } from '@docket/billing/contracts';`;

    expect(scanDeliveryDomainRuntimePolicy(DESKTOP_FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({
        rule: 'unsupported-deployable-runtime',
        specifier: '@docket/billing/contracts',
      }),
    ]);
  });

  it('applies domain runtime boundaries to delivery build configuration and scripts', () => {
    const source = `import { billingContract } from '@docket/billing/contracts';`;

    for (const filePath of [WEB_BUILD_CONFIG_FIXTURE_PATH, WEB_BUILD_SCRIPT_FIXTURE_PATH]) {
      expect(scanDeliveryDomainRuntimePolicy(filePath, source)).toEqual([
        expect.objectContaining({
          rule: 'unsupported-deployable-runtime',
          specifier: '@docket/billing/contracts',
        }),
      ]);
    }
  });

  it('rejects unsupported delivery runtime bypasses across every import form', () => {
    const source = `
      import { billingContract } from '@docket/billing/contracts';
      export { billingContract as exportedBillingContract } from '@docket/billing/contracts';
      type BillingContract = import('@docket/billing/contracts').BillingContract;
      const dynamicBilling = await import('@docket/billing/contracts');
      const dynamicBillingWithOptions = await import('@docket/billing/contracts', { with: {} });
      const requiredBilling = require('@docket/billing/contracts');
      import BillingContracts = require('@docket/billing/contracts');
    `;

    expect(scanDeliveryDomainRuntimePolicy(WEB_FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({
        rule: 'unsupported-deployable-runtime',
        specifier: '@docket/billing/contracts',
      }),
      expect.objectContaining({
        rule: 'unsupported-deployable-runtime',
        specifier: '@docket/billing/contracts',
      }),
      expect.objectContaining({
        rule: 'unsupported-deployable-runtime',
        specifier: '@docket/billing/contracts',
      }),
      expect.objectContaining({
        rule: 'unsupported-deployable-runtime',
        specifier: '@docket/billing/contracts',
      }),
      expect.objectContaining({
        rule: 'unsupported-deployable-runtime',
        specifier: '@docket/billing/contracts',
      }),
      expect.objectContaining({
        rule: 'unsupported-deployable-runtime',
        specifier: '@docket/billing/contracts',
      }),
      expect.objectContaining({
        rule: 'unsupported-deployable-runtime',
        specifier: '@docket/billing/contracts',
      }),
    ]);
  });

  it('rejects nonliteral module loads in guarded source without matching unrelated calls', () => {
    const source = `
      const dynamicModule = await import(moduleName);
      const requiredModule = require(relativeModule);
      const unrelated = load(moduleName);
    `;

    for (const filePath of [FIXTURE_PATH, WEB_FIXTURE_PATH]) {
      expect(scanDomainImportPolicy(filePath, source)).toEqual([
        expect.objectContaining({ rule: 'dynamic-module-specifier', specifier: 'moduleName' }),
        expect.objectContaining({ rule: 'dynamic-module-specifier', specifier: 'relativeModule' }),
      ]);
    }
    expect(
      scanDomainImportPolicy(resolve(WORKSPACE_ROOT, 'packages/db/src/example.ts'), source),
    ).toEqual([]);
  });

  it('rejects every module loader origin in guarded source', () => {
    const source = `
      import * as nodeModule from 'node:module';
      export * from 'node:module';
      const propertyAlias = require('node:module').createRequire;
      import LegacyModule = require('module');
      const load = require;
      const moduleLoad = module.require;
      const loaded = module.require(moduleName);
      const directLiteralLoad = require('node:fs');
      const normalLiteralImport = await import('node:path');
    `;

    expect(scanDomainImportPolicy(FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({
        rule: 'module-loader-alias',
        specifier: 'node:module',
      }),
      expect.objectContaining({
        rule: 'module-loader-alias',
        specifier: 'node:module',
      }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'node:module' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module.require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module.require' }),
    ]);
  });

  it('rejects Node loader factories and legacy main-module loaders in guarded source', () => {
    const source = `
      const builtinModule = process.getBuiltinModule('node:module');
      const builtinRequire = builtinModule.createRequire(import.meta.url);
      const builtinTypes = builtinRequire('@docket/types');
      const mainModuleTypes = process.mainModule.require('@docket/types');
    `;

    expect(scanDomainImportPolicy(FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({
        rule: 'module-loader-alias',
        specifier: 'process.getBuiltinModule(node:module)',
      }),
      expect.objectContaining({
        rule: 'module-loader-alias',
        specifier: 'process.mainModule',
      }),
    ]);
  });

  it('rejects global and required process origins for Node loader factories', () => {
    const source = `
      const globalThisTypes = globalThis.process
        .getBuiltinModule('node:module')
        .createRequire(import.meta.url)('@docket/types');
      const globalTypes = global.process
        .getBuiltinModule('node:module')
        .createRequire(import.meta.url)('@docket/types');
      const requiredProcessTypes = require('node:process')
        .getBuiltinModule('node:module')
        .createRequire(import.meta.url)('@docket/types');
    `;

    expect(scanDomainImportPolicy(FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({
        rule: 'module-loader-alias',
        specifier: 'globalThis.process.getBuiltinModule(node:module)',
      }),
      expect.objectContaining({
        rule: 'module-loader-alias',
        specifier: 'global.process.getBuiltinModule(node:module)',
      }),
      expect.objectContaining({
        rule: 'module-loader-alias',
        specifier: 'require(node:process).getBuiltinModule(node:module)',
      }),
    ]);
  });

  it('rejects a named node:process loader-factory import in guarded source', () => {
    const source = `
      import { getBuiltinModule as loadBuiltinModule } from 'node:process';

      const legacyTypes = loadBuiltinModule('node:module')
        .createRequire(import.meta.url)('@docket/types');
    `;

    expect(scanDomainImportPolicy(FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({
        rule: 'module-loader-alias',
        specifier: 'node:process.getBuiltinModule',
      }),
    ]);
  });

  it('rejects only loader-factory access through default and namespace node:process imports', () => {
    const source = `
      import defaultProcess from 'node:process';
      import * as namespaceProcess from 'node:process';

      const currentDirectory = defaultProcess.cwd();
      const platform = namespaceProcess.platform;
      const defaultTypes = defaultProcess
        .getBuiltinModule('node:module')
        .createRequire(import.meta.url)('@docket/types');
      const namespaceTypes = namespaceProcess
        .getBuiltinModule('node:module')
        .createRequire(import.meta.url)('@docket/types');
    `;

    expect(scanDomainImportPolicy(FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({
        rule: 'module-loader-alias',
        specifier: 'defaultProcess.getBuiltinModule',
      }),
      expect.objectContaining({
        rule: 'module-loader-alias',
        specifier: 'namespaceProcess.getBuiltinModule',
      }),
    ]);
  });

  it('rejects direct process-origin variable declarations and assignments that reach a loader factory', () => {
    const source = `
      const bareProcess = process;
      let globalProcess;
      globalProcess = globalThis.process;
      const requiredProcess = require('node:process');

      const bareTypes = bareProcess
        .getBuiltinModule('node:module')
        .createRequire(import.meta.url)('@docket/types');
      const globalTypes = globalProcess
        .getBuiltinModule('node:module')
        .createRequire(import.meta.url)('@docket/types');
      const requiredTypes = requiredProcess
        .getBuiltinModule('node:module')
        .createRequire(import.meta.url)('@docket/types');
    `;

    expect(scanDomainImportPolicy(FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({
        rule: 'module-loader-alias',
        specifier: 'bareProcess.getBuiltinModule',
      }),
      expect.objectContaining({
        rule: 'module-loader-alias',
        specifier: 'globalProcess.getBuiltinModule',
      }),
      expect.objectContaining({
        rule: 'module-loader-alias',
        specifier: 'requiredProcess.getBuiltinModule',
      }),
    ]);
  });

  it('rejects suffix-marked module loader origins while preserving raw diagnostics', () => {
    const source = `
      import * as nodeModule from 'node:module?raw';
      export * from 'module#fixture';
    `;

    expect(scanDomainImportPolicy(FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'node:module?raw' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module#fixture' }),
    ]);
  });

  it('rejects CommonJS require alias origins while allowing direct literal require calls', () => {
    const source = `
      const load = require;
      let reassignedLoad;
      reassignedLoad = require;
      function read(defaultLoad = require) {
        return defaultLoad;
      }
      const directLiteralLoad = require('node:fs');
    `;

    expect(scanDomainImportPolicy(CJS_FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'require' }),
    ]);
  });

  it('does not reserve harmless require names while scanning lexical require calls', () => {
    const harmlessSource = `
      const require = localLoader;
      function echo(require) {}
      const { require: configuredRequire } = config;
      const configObject = { require: false };
      const directLiteralLoad = require('node:fs');
    `;
    const nonliteralSource = `
      const require = localLoader;
      const directLoad = require(moduleName);
    `;

    expect(scanDomainImportPolicy(CJS_FIXTURE_PATH, harmlessSource)).toEqual([]);
    expect(scanDomainImportPolicy(CJS_FIXTURE_PATH, nonliteralSource)).toEqual([
      expect.objectContaining({ rule: 'dynamic-module-specifier', specifier: 'moduleName' }),
    ]);
  });

  it('reserves lexical require values in guarded source because they can be loader aliases', () => {
    const source = `
      const directAlias = require;
      const boundAlias = require.bind(null);
      const calledAlias = require.call(null, 'node:fs');
      const parenthesizedAlias = (require);
      const commaAlias = (0, require);
      function echo(require) {
        return require;
      }
    `;

    expect(scanDomainImportPolicy(CJS_FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'require' }),
    ]);
  });

  it('rejects loader destructuring origins without reserving ordinary properties', () => {
    const source = `
      const { require: fromModule } = module;
      const { require: fromGlobal } = globalThis;
      const { ['require']: computedFromModule } = module;
      function read({ require: fromDefault } = globalThis) {
        return fromDefault;
      }
      const { require: label } = config;
    `;

    expect(scanDomainImportPolicy(CJS_FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module.require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'globalThis.require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module.require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'globalThis.require' }),
    ]);
  });

  it('rejects loader-global declaration and assignment aliases without rejecting ordinary config assignments', () => {
    const source = `
      const declaredModule = module;
      const declaredGlobal = globalThis;
      let currentModule;
      let currentGlobal;
      currentModule = module;
      currentGlobal = globalThis;
      ({ require: fromModule } = module);
      ({ ['require']: fromGlobal } = globalThis);
      ({ require: configuredLoader } = config);
      currentConfig = config;
      const timeout = globalThis.setTimeout;
    `;

    expect(scanDomainImportPolicy(CJS_FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'globalThis' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'globalThis' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module.require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'globalThis.require' }),
    ]);
  });

  it('rejects parenthesized and TypeScript-asserted loader-global aliases', () => {
    const source = `
      const parenthesizedModule = (module);
      const assertedModule = module as typeof module;
      const nonNullModule = module!;
      const satisfiesGlobal = globalThis satisfies typeof globalThis;
      const parenthesizedLoader = (module).require;
      const assertedLoader = (globalThis as typeof globalThis).require;
      const { require: wrappedFromModule } = (module as unknown);
      ({ require: wrappedFromGlobal } = (globalThis));
    `;

    expect(scanDomainImportPolicy(FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'globalThis' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module.require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'globalThis.require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module.require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'globalThis.require' }),
    ]);
  });

  it('rejects transparent wrappers around CommonJS loader property keys', () => {
    const source = `
      const parenthesizedKey = module[('require')];
      const assertedKey = globalThis['require' as string];
      const { ['require' as string]: fromModule } = module;
      ({ ['require' as string]: fromGlobal } = globalThis);
    `;

    expect(scanDomainImportPolicy(FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module.require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'globalThis.require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module.require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'globalThis.require' }),
    ]);
  });

  it('rejects CommonJS loader properties without rejecting ordinary property names', () => {
    const source = `
      const computedLoad = module['require'];
      const globalLoad = globalThis.require;
      const computedGlobalLoad = globalThis['require'];
      const config = { require: false };
      const ordinaryComputedProperty = config['require'];
      interface Requirement {
        require: boolean;
      }
      interface RequirementMethods {
        require(): void;
      }
      class Workflow {
        require = false;
      }
      const handlers = {
        require() {},
      }
    `;

    expect(scanDomainImportPolicy(CJS_FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'module.require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'globalThis.require' }),
      expect.objectContaining({ rule: 'module-loader-alias', specifier: 'globalThis.require' }),
    ]);
  });

  it('ignores conventional package and nested source-local test directories but guards src/testing', () => {
    const source = `import { api } from '@docket/api';`;

    expect(scanDomainImportPolicy(PACKAGE_TEST_FIXTURE_PATH, source)).toEqual([]);
    for (const filePath of SOURCE_LOCAL_TEST_FIXTURE_PATHS) {
      expect(scanDomainImportPolicy(filePath, source)).toEqual([]);
    }
    expect(scanDomainImportPolicy(TEST_NAMED_PRODUCTION_FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/api' }),
    ]);
  });

  it('keeps conventional source-local test directories out of collected production files', () => {
    const sourceDirectory = mkdtempSync(resolve(tmpdir(), 'docket-source-policy-'));
    const sourceFiles = [
      '__tests__/fixture.ts',
      'nested/__tests__/fixture.ts',
      'nested/test/fixture.ts',
      'nested/testing/production.ts',
      'nested/tests/fixture.ts',
      'production.ts',
      'test/fixture.ts',
      'testing/production.ts',
      'tests/fixture.ts',
    ];

    try {
      for (const relativePath of sourceFiles) {
        const filePath = resolve(sourceDirectory, relativePath);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, 'export {};');
      }

      expect(
        collectPackageSourceFiles(sourceDirectory)
          .map((filePath) => filePath.slice(`${sourceDirectory}/`.length))
          .sort(),
      ).toEqual(['nested/testing/production.ts', 'production.ts', 'testing/production.ts']);
    } finally {
      rmSync(sourceDirectory, { force: true, recursive: true });
    }
  });

  it('collects delivery build configuration and scripts outside src while excluding test tooling', () => {
    const entrypointFiles = collectDeliveryProductionEntrypointFiles().map(relativeToWorkspaceRoot);

    expect(entrypointFiles).toEqual(
      expect.arrayContaining([
        'apps/admin/next.config.ts',
        'apps/web/next.config.ts',
        'apps/web/postcss.config.js',
        'apps/web/scripts/generate-offline-routes.ts',
        'apps/web/scripts/offline-route-policy.ts',
      ]),
    );
    expect(entrypointFiles).not.toEqual(
      expect.arrayContaining([
        'apps/admin/vitest.config.ts',
        'apps/runner/vitest.config.ts',
        'apps/web/playwright.config.ts',
        'apps/web/vite.config.ts',
      ]),
    );
  });

  it('parses each supported JavaScript and TypeScript production module extension', () => {
    const source = `import { api } from '@docket/api';`;

    for (const filePath of MODULE_FORMAT_FIXTURE_PATHS) {
      expect(scanDomainImportPolicy(filePath, source)).toEqual([
        expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/api' }),
      ]);
    }
  });

  it('rejects legacy types, database, and delivery imports from Automation source', () => {
    const source = `
      import { z } from 'zod';
      import type { Predicate } from '@docket/types';
      import { db } from '@docket/db';
      import { runAutomations } from '@docket/api';
    `;

    expect(scanDomainImportPolicy(AUTOMATION_CONTRACTS_FIXTURE_PATH, source)).toEqual([
      expect.objectContaining({ rule: 'generic-types', specifier: '@docket/types' }),
      expect.objectContaining({ rule: 'workspace-dependency', specifier: '@docket/db' }),
      expect.objectContaining({ rule: 'app-delivery', specifier: '@docket/api' }),
    ]);
  });

  it('keeps Automation grammar and evaluation source portable', () => {
    const automationSourceFiles = new Set<string>(AUTOMATION_SOURCE_FILES);
    const sourceFiles = collectWorkspaceSourceFiles().filter((filePath) =>
      automationSourceFiles.has(filePath),
    );
    const violations = sourceFiles.flatMap((filePath) => scanDomainImportPolicy(filePath));

    expect(sourceFiles).toEqual(expect.arrayContaining([...AUTOMATION_SOURCE_FILES]));
    expect(
      violations,
      `Automation grammar and evaluation must remain portable:\n${formatDomainImportViolations(violations)}`,
    ).toEqual([]);
  });

  it('keeps production domain code independent of app delivery, UI, environment, and testing code', () => {
    const violations = collectWorkspaceSourceFiles()
      .filter((filePath) => relativeToWorkspaceRoot(filePath).startsWith('domains/'))
      .flatMap((filePath) => scanDomainImportPolicy(filePath));

    expect(
      violations,
      [
        'Domain runtime code is reusable product behavior, not a delivery layer.',
        'Move presentation to an app, environment access to an adapter, and test fixtures to test code.',
        'Domain packages may use deliberate public domain contracts and narrow technical capabilities, never another domain’s source tree.',
        formatDomainImportViolations(violations),
      ].join('\n'),
    ).toEqual([]);
  });

  it('keeps production delivery imports within domain boundaries and runtime contracts', () => {
    const entrypointFiles = collectDeliveryProductionEntrypointFiles();
    const violations = [...new Set([...collectWorkspaceSourceFiles(), ...entrypointFiles])]
      .filter((filePath) => deliveryRuntimeForSource(filePath) !== undefined)
      .flatMap((filePath) =>
        scanDeliveryDomainImportPolicy(filePath, readFileSync(filePath, 'utf8')),
      );

    expect(
      violations,
      [
        'Production apps and their build/configuration entrypoints must use public domain imports from runtimes declared in domains/registry.json.',
        'They may not read another workspace package source tree or dynamically resolve an opaque module.',
        formatDomainImportViolations(violations),
      ].join('\n'),
    ).toEqual([]);
  }, 60_000);
});
