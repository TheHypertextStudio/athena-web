import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  collectPackageProductionEntrypointFiles,
  collectWorkspacePackages,
  collectWorkspaceSourceFiles,
  relativeToWorkspaceRoot,
  WORKSPACE_ROOT,
} from '../workspace';

type MigratedContractImportKind =
  | 'dynamic-import'
  | 'export-star'
  | 'import-type'
  | 'import-type-namespace'
  | 'import-equals'
  | 'named'
  | 'namespace'
  | 'require';

interface MigratedContractImportViolation {
  readonly column: number;
  readonly file: string;
  readonly kind: MigratedContractImportKind;
  readonly line: number;
  readonly replacement: string;
  readonly symbol: string;
}

const PRODUCTION_FIXTURE = resolve(WORKSPACE_ROOT, 'apps/api/src/example.ts');
const TYPES_AUTOMATION_COMPATIBILITY_FACADE_FIXTURE = resolve(
  WORKSPACE_ROOT,
  'packages/types/src/automation.ts',
);
const UNAPPROVED_TYPES_AUTOMATION_FIXTURE = resolve(
  WORKSPACE_ROOT,
  'packages/types/src/automation-runtime.ts',
);
const TEST_FIXTURE = resolve(WORKSPACE_ROOT, 'apps/api/tests/legacy-contract.test.ts');
const TYPES_PACKAGE = '@docket/types';
const WILDCARD_REPLACEMENT = 'explicit public contract subpaths';
const RUNTIME_MODULE_LOADER_SPECIFIERS = new Set(['module', 'node:module']);
const PROCESS_MODULE_SPECIFIERS = new Set(['process', 'node:process']);

const MIGRATED_CONTRACT_MODULES = [
  {
    sourcePath: resolve(WORKSPACE_ROOT, 'domains/athena/src/voice.ts'),
    replacement: '@docket/athena/voice',
  },
  {
    sourcePath: resolve(WORKSPACE_ROOT, 'domains/athena/src/phone.ts'),
    replacement: '@docket/athena/phone',
  },
  {
    sourcePath: resolve(WORKSPACE_ROOT, 'domains/connections/src/notion/mirror-contract.ts'),
    replacement: '@docket/connections/notion/mirror-contract',
  },
] as const;

const MIGRATED_SYMBOL_REPLACEMENTS = migratedSymbolReplacements();

function isTestFile(path: string): boolean {
  return /(?:^|\/)(?:__tests__|tests?)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
}

function isProductionSource(filePath: string): boolean {
  return !isTestFile(filePath);
}

function scriptKind(filePath: string): ts.ScriptKind {
  return filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function exportedSymbols(sourcePath: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    readFileSync(sourcePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(sourcePath),
  );
  const symbols = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!isExported(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) symbols.add(declaration.name.text);
      }
      continue;
    }
    if (
      (ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)) &&
      statement.name
    ) {
      symbols.add(statement.name.text);
    }
  }

  return [...symbols];
}

function isExported(node: ts.Node): boolean {
  return Boolean(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export);
}

function migratedSymbolReplacements(): ReadonlyMap<string, string> {
  const replacements = new Map<string, string>([
    ['Priority', '@docket/work/task-contract'],
    ['Capability', '@docket/identity-access/capabilities'],
    ['GrantCapability', '@docket/identity-access/capabilities'],
    ['CAPABILITY_RANK', '@docket/identity-access/capabilities'],
    ['satisfies', '@docket/identity-access/capabilities'],
    ['GrantSubjectKind', '@docket/identity-access/grants'],
    ['GrantResourceKind', '@docket/identity-access/grants'],
    ['PredicateValue', '@docket/automation/contracts'],
    ['PredicateLeafOp', '@docket/automation/contracts'],
    ['Predicate', '@docket/automation/contracts'],
    ['ActionSpec', '@docket/automation/contracts'],
    ['AutomationEventMatch', '@docket/automation/contracts'],
    ['AutomationRule', '@docket/automation/contracts'],
  ]);
  for (const contract of MIGRATED_CONTRACT_MODULES) {
    for (const symbol of exportedSymbols(contract.sourcePath)) {
      const existingReplacement = replacements.get(symbol);
      if (existingReplacement && existingReplacement !== contract.replacement) {
        throw new Error(`Migrated contract symbol ${symbol} has two owners.`);
      }
      replacements.set(symbol, contract.replacement);
    }
  }
  return replacements;
}

function isTypesModuleSpecifier(
  moduleSpecifier: ts.Expression | undefined,
): moduleSpecifier is ts.StringLiteralLike {
  return Boolean(
    moduleSpecifier &&
    ts.isStringLiteralLike(moduleSpecifier) &&
    moduleSpecifier.text === TYPES_PACKAGE,
  );
}

/** Remove TypeScript-only wrappers before inspecting a runtime module-loader expression. */
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

function staticStringLiteralText(expression: ts.Expression | undefined): string | undefined {
  if (!expression) return undefined;
  const unwrapped = unwrapTransparentExpression(expression);
  return ts.isStringLiteralLike(unwrapped) ? unwrapped.text : undefined;
}

function isRuntimeModuleLoaderSpecifier(
  moduleSpecifier: ts.Expression | undefined,
): moduleSpecifier is ts.StringLiteralLike {
  return Boolean(
    moduleSpecifier &&
    ts.isStringLiteralLike(moduleSpecifier) &&
    RUNTIME_MODULE_LOADER_SPECIFIERS.has(moduleSpecifier.text),
  );
}

function isModuleLoaderGlobal(expression: ts.Expression): boolean {
  const unwrapped = unwrapTransparentExpression(expression);
  return (
    ts.isIdentifier(unwrapped) &&
    (unwrapped.text === 'module' || unwrapped.text === 'global' || unwrapped.text === 'globalThis')
  );
}

function isGlobalObject(expression: ts.Expression): boolean {
  const unwrapped = unwrapTransparentExpression(expression);
  return (
    ts.isIdentifier(unwrapped) && (unwrapped.text === 'global' || unwrapped.text === 'globalThis')
  );
}

function isRequiredProcess(expression: ts.Expression): boolean {
  const unwrapped = unwrapTransparentExpression(expression);
  if (!ts.isCallExpression(unwrapped)) return false;
  const callee = unwrapTransparentExpression(unwrapped.expression);
  if (!ts.isIdentifier(callee) || callee.text !== 'require') return false;
  const [moduleSpecifier] = unwrapped.arguments;
  return Boolean(
    moduleSpecifier &&
    PROCESS_MODULE_SPECIFIERS.has(staticStringLiteralText(moduleSpecifier) ?? ''),
  );
}

function isProcessGlobal(expression: ts.Expression): boolean {
  const unwrapped = unwrapTransparentExpression(expression);
  if (ts.isIdentifier(unwrapped) && unwrapped.text === 'process') return true;
  if (ts.isPropertyAccessExpression(unwrapped)) {
    return unwrapped.name.text === 'process' && isGlobalObject(unwrapped.expression);
  }
  if (ts.isElementAccessExpression(unwrapped)) {
    return (
      staticStringLiteralText(unwrapped.argumentExpression) === 'process' &&
      isGlobalObject(unwrapped.expression)
    );
  }
  return isRequiredProcess(unwrapped);
}

function isProcessProperty(expression: ts.Expression, propertyName: string): boolean {
  const unwrapped = unwrapTransparentExpression(expression);
  if (ts.isPropertyAccessExpression(unwrapped)) {
    return unwrapped.name.text === propertyName && isProcessGlobal(unwrapped.expression);
  }
  return (
    ts.isElementAccessExpression(unwrapped) &&
    staticStringLiteralText(unwrapped.argumentExpression) === propertyName &&
    isProcessGlobal(unwrapped.expression)
  );
}

function isProcessMainModuleAccess(node: ts.Node): boolean {
  return (
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
    isProcessProperty(node, 'mainModule')
  );
}

/** Detect Node's direct factory for a CommonJS loader without allowing a runtime alias. */
function isProcessBuiltinModuleLoaderFactory(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !isProcessProperty(node.expression, 'getBuiltinModule')) {
    return false;
  }
  const [moduleSpecifier] = node.arguments;
  return Boolean(
    moduleSpecifier &&
    RUNTIME_MODULE_LOADER_SPECIFIERS.has(staticStringLiteralText(moduleSpecifier) ?? ''),
  );
}

/** Block the one named node:process import that fabricates a runtime module loader. */
function nodeProcessLoaderFactoryImport(node: ts.Node): ts.ImportSpecifier | undefined {
  if (
    !ts.isImportDeclaration(node) ||
    !node.importClause ||
    node.importClause.phaseModifier === ts.SyntaxKind.TypeKeyword ||
    !ts.isStringLiteralLike(node.moduleSpecifier) ||
    !PROCESS_MODULE_SPECIFIERS.has(node.moduleSpecifier.text)
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
      !PROCESS_MODULE_SPECIFIERS.has(statement.moduleSpecifier.text)
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
      isProcessGlobal(unwrapped) ||
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

function processModuleAliasLoaderBinding(
  node: ts.Node,
  aliases: ReadonlySet<string>,
): ts.Node | undefined {
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
    ? node
    : undefined;
}

function isModuleLoaderRequireProperty(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === 'require' && isModuleLoaderGlobal(node.expression);
  }
  return (
    ts.isElementAccessExpression(node) &&
    staticStringLiteralText(node.argumentExpression) === 'require' &&
    isModuleLoaderGlobal(node.expression)
  );
}

function bindingPropertyName(binding: ts.BindingElement): string | undefined {
  const propertyName = binding.propertyName ?? binding.name;
  if (ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName))
    return propertyName.text;
  return ts.isComputedPropertyName(propertyName)
    ? staticStringLiteralText(propertyName.expression)
    : undefined;
}

function moduleLoaderDestructuringAccessForPattern(
  pattern: ts.ObjectBindingPattern,
  initializer: ts.Expression | undefined,
): ts.BindingElement | undefined {
  if (!initializer || !isModuleLoaderGlobal(initializer)) return undefined;
  return pattern.elements.find((element) => bindingPropertyName(element) === 'require');
}

function moduleLoaderDestructuringAccess(node: ts.Node): ts.BindingElement | undefined {
  if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
    return moduleLoaderDestructuringAccessForPattern(node.name, node.initializer);
  }
  if (ts.isParameter(node) && ts.isObjectBindingPattern(node.name)) {
    return moduleLoaderDestructuringAccessForPattern(node.name, node.initializer);
  }
  return undefined;
}

function propertyAssignmentName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (!ts.isPropertyAssignment(property)) return undefined;
  if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
    return property.name.text;
  return ts.isComputedPropertyName(property.name)
    ? staticStringLiteralText(property.name.expression)
    : undefined;
}

function moduleLoaderAssignmentAccess(node: ts.Node): ts.ObjectLiteralElementLike | undefined {
  if (
    !ts.isBinaryExpression(node) ||
    node.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
    !ts.isObjectLiteralExpression(node.left) ||
    !isModuleLoaderGlobal(node.right)
  ) {
    return undefined;
  }
  return node.left.properties.find((property) => propertyAssignmentName(property) === 'require');
}

function moduleLoaderGlobalAliasAccess(node: ts.Node): ts.Identifier | undefined {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    return isModuleLoaderGlobal(node.initializer) ? node.name : undefined;
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(node.left) &&
    isModuleLoaderGlobal(node.right)
  ) {
    return node.left;
  }
  return undefined;
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
 * Treat lexical `require` values as opaque runtime loaders in production code.
 *
 * Without a type checker the policy cannot prove that an alias is harmless, so a loader must be
 * called directly with a statically known module specifier rather than assigned or wrapped.
 */
function isRequireValueReference(node: ts.Node): node is ts.Identifier {
  return (
    isRequireIdentifier(node) &&
    !isDirectRequireCallCallee(node) &&
    !ts.isExternalModuleReference(node.parent) &&
    !isRequireDeclarationOrPropertyName(node)
  );
}

function namedTypesBindings(node: ts.Node): readonly (ts.ImportSpecifier | ts.ExportSpecifier)[] {
  if (ts.isImportDeclaration(node)) {
    if (!isTypesModuleSpecifier(node.moduleSpecifier)) return [];
    const bindings = node.importClause?.namedBindings;
    return bindings && ts.isNamedImports(bindings) ? bindings.elements : [];
  }
  if (ts.isExportDeclaration(node)) {
    if (!isTypesModuleSpecifier(node.moduleSpecifier)) return [];
    return node.exportClause && ts.isNamedExports(node.exportClause)
      ? node.exportClause.elements
      : [];
  }
  return [];
}

function wildcardTypesBinding(
  node: ts.Node,
):
  | { readonly kind: 'export-star' | 'namespace'; readonly moduleSpecifier: ts.StringLiteralLike }
  | undefined {
  if (ts.isImportDeclaration(node)) {
    const bindings = node.importClause?.namedBindings;
    return isTypesModuleSpecifier(node.moduleSpecifier) &&
      bindings &&
      ts.isNamespaceImport(bindings)
      ? { kind: 'namespace', moduleSpecifier: node.moduleSpecifier }
      : undefined;
  }
  if (!ts.isExportDeclaration(node) || !isTypesModuleSpecifier(node.moduleSpecifier)) {
    return undefined;
  }
  return !node.exportClause || ts.isNamespaceExport(node.exportClause)
    ? { kind: 'export-star', moduleSpecifier: node.moduleSpecifier }
    : undefined;
}

function runtimeWildcardTypesBinding(node: ts.Node):
  | {
      readonly kind: 'dynamic-import' | 'import-equals' | 'require';
      readonly moduleSpecifier: ts.Expression;
    }
  | undefined {
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return isTypesModuleSpecifier(node.moduleReference.expression)
      ? { kind: 'import-equals', moduleSpecifier: node.moduleReference.expression }
      : undefined;
  }
  if (!ts.isCallExpression(node) || node.arguments.length === 0) return undefined;
  const [argument] = node.arguments;
  if (!argument) return undefined;
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return isTypesModuleSpecifier(argument) || !ts.isStringLiteralLike(argument)
      ? { kind: 'dynamic-import', moduleSpecifier: argument }
      : undefined;
  }
  return ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    (isTypesModuleSpecifier(argument) || !ts.isStringLiteralLike(argument))
    ? { kind: 'require', moduleSpecifier: argument }
    : undefined;
}

function runtimeModuleLoaderBinding(
  node: ts.Node,
): { readonly kind: 'dynamic-import' | 'require'; readonly node: ts.Node } | undefined {
  const destructuring = moduleLoaderDestructuringAccess(node);
  const assignment = moduleLoaderAssignmentAccess(node);
  const globalAlias = moduleLoaderGlobalAliasAccess(node);
  const nodeProcessLoaderImport = nodeProcessLoaderFactoryImport(node);
  if (nodeProcessLoaderImport) return { kind: 'require', node: nodeProcessLoaderImport };
  if (isProcessBuiltinModuleLoaderFactory(node) || isProcessMainModuleAccess(node)) {
    return { kind: 'require', node };
  }
  if (isRequireValueReference(node) || isModuleLoaderRequireProperty(node)) {
    return { kind: 'require', node };
  }
  const aliasedLoader = destructuring ?? assignment ?? globalAlias;
  if (aliasedLoader) return { kind: 'require', node: aliasedLoader };
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    isRuntimeModuleLoaderSpecifier(node.moduleSpecifier)
  ) {
    return { kind: 'require', node: node.moduleSpecifier };
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return isRuntimeModuleLoaderSpecifier(node.moduleReference.expression)
      ? { kind: 'require', node: node.moduleReference.expression }
      : undefined;
  }
  if (!ts.isCallExpression(node) || node.arguments.length === 0) return undefined;
  const [argument] = node.arguments;
  if (!argument || !isRuntimeModuleLoaderSpecifier(argument)) return undefined;
  return node.expression.kind === ts.SyntaxKind.ImportKeyword
    ? { kind: 'dynamic-import', node: argument }
    : ts.isIdentifier(node.expression) && node.expression.text === 'require'
      ? { kind: 'require', node: argument }
      : undefined;
}

function importTypeModuleSpecifier(node: ts.ImportTypeNode): ts.StringLiteralLike | undefined {
  return ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)
    ? node.argument.literal
    : undefined;
}

function importTypeQualifierSymbol(qualifier: ts.EntityName | undefined): string | undefined {
  return qualifier && ts.isIdentifier(qualifier) ? qualifier.text : qualifier?.right.text;
}

function collectMigratedContractPolicyFiles(): readonly string[] {
  const entrypointFiles = collectWorkspacePackages().flatMap((workspacePackage) =>
    collectPackageProductionEntrypointFiles(workspacePackage.directory, workspacePackage.manifest),
  );
  return [...new Set([...collectWorkspaceSourceFiles(), ...entrypointFiles])];
}

function migratedContractImportViolations(
  filePath: string,
  sourceText: string,
): readonly MigratedContractImportViolation[] {
  if (!isProductionSource(filePath)) return [];
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(filePath),
  );
  const violations: MigratedContractImportViolation[] = [];
  const processModuleAliases = processAliases(sourceFile);

  function visit(node: ts.Node): void {
    const processModuleAliasLoader = processModuleAliasLoaderBinding(node, processModuleAliases);
    const runtimeModuleLoader = processModuleAliasLoader
      ? { kind: 'require' as const, node: processModuleAliasLoader }
      : runtimeModuleLoaderBinding(node);
    if (runtimeModuleLoader) {
      const location = sourceFile.getLineAndCharacterOfPosition(
        runtimeModuleLoader.node.getStart(sourceFile),
      );
      violations.push({
        column: location.character + 1,
        file: relativeToWorkspaceRoot(filePath),
        kind: runtimeModuleLoader.kind,
        line: location.line + 1,
        replacement: WILDCARD_REPLACEMENT,
        symbol: '*',
      });
      ts.forEachChild(node, visit);
      return;
    }
    for (const binding of namedTypesBindings(node)) {
      const symbol = (binding.propertyName ?? binding.name).text;
      const replacement = MIGRATED_SYMBOL_REPLACEMENTS.get(symbol);
      if (!replacement) continue;
      const location = sourceFile.getLineAndCharacterOfPosition(binding.getStart(sourceFile));
      violations.push({
        column: location.character + 1,
        file: relativeToWorkspaceRoot(filePath),
        kind: 'named',
        line: location.line + 1,
        replacement,
        symbol,
      });
    }
    const wildcard = wildcardTypesBinding(node);
    if (wildcard) {
      const location = sourceFile.getLineAndCharacterOfPosition(
        wildcard.moduleSpecifier.getStart(sourceFile),
      );
      violations.push({
        column: location.character + 1,
        file: relativeToWorkspaceRoot(filePath),
        kind: wildcard.kind,
        line: location.line + 1,
        replacement: WILDCARD_REPLACEMENT,
        symbol: '*',
      });
    }
    const runtimeWildcard = runtimeWildcardTypesBinding(node);
    if (runtimeWildcard) {
      const location = sourceFile.getLineAndCharacterOfPosition(
        runtimeWildcard.moduleSpecifier.getStart(sourceFile),
      );
      violations.push({
        column: location.character + 1,
        file: relativeToWorkspaceRoot(filePath),
        kind: runtimeWildcard.kind,
        line: location.line + 1,
        replacement: WILDCARD_REPLACEMENT,
        symbol: '*',
      });
    }
    if (ts.isImportTypeNode(node)) {
      const moduleSpecifier = importTypeModuleSpecifier(node);
      if (moduleSpecifier && isTypesModuleSpecifier(moduleSpecifier)) {
        const symbol = importTypeQualifierSymbol(node.qualifier);
        const replacement = symbol ? MIGRATED_SYMBOL_REPLACEMENTS.get(symbol) : undefined;
        if (replacement || symbol === undefined) {
          const location = sourceFile.getLineAndCharacterOfPosition(
            moduleSpecifier.getStart(sourceFile),
          );
          violations.push({
            column: location.character + 1,
            file: relativeToWorkspaceRoot(filePath),
            kind: symbol === undefined ? 'import-type-namespace' : 'import-type',
            line: location.line + 1,
            replacement: replacement ?? WILDCARD_REPLACEMENT,
            symbol: symbol ?? '*',
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

describe('migrated contract import policy', () => {
  it('finds real named imports and re-exports without matching comments or string literals', () => {
    const source = `
      // import type { Priority } from '@docket/types';
      const documentation = "import type { VoiceInboundEvent } from '@docket/types'";
      import type { Priority as TaskPriority, VoiceInboundEvent } from '@docket/types';
      import { NotionMirrorEntity } from '@docket/types';
      export { type PhoneNumberOut as CallerPhone } from '@docket/types';
      import type { TaskOut } from '@docket/types';
      import { Capability, GrantCapability, CAPABILITY_RANK, satisfies } from '@docket/types';
      import type { GrantResourceKind, GrantSubjectKind } from '@docket/types';
      import type {
        ActionSpec,
        AutomationEventMatch,
        AutomationRule,
        Predicate,
        PredicateLeafOp,
        PredicateValue,
      } from '@docket/types';
      export { type AutomationRule as LegacyAutomationRule } from '@docket/types';
      import * as LegacyTypes from '@docket/types';
      export * from '@docket/types';
      type MirrorContract = import('@docket/types').NotionMirrorEntity;
      type AutomationContract = import('@docket/types').AutomationRule;
      type LegacyNamespace = import('@docket/types');
      const dynamicTypes = await import('@docket/types');
      const dynamicTypesWithOptions = await import('@docket/types', { with: {} });
      const requiredTypes = require('@docket/types');
      import LegacyRequire = require('@docket/types');
    `;

    expect(migratedContractImportViolations(PRODUCTION_FIXTURE, source)).toEqual([
      expect.objectContaining({
        symbol: 'Priority',
        replacement: '@docket/work/task-contract',
      }),
      expect.objectContaining({
        symbol: 'VoiceInboundEvent',
        replacement: '@docket/athena/voice',
      }),
      expect.objectContaining({
        symbol: 'NotionMirrorEntity',
        replacement: '@docket/connections/notion/mirror-contract',
      }),
      expect.objectContaining({
        symbol: 'PhoneNumberOut',
        replacement: '@docket/athena/phone',
      }),
      expect.objectContaining({
        symbol: 'Capability',
        replacement: '@docket/identity-access/capabilities',
      }),
      expect.objectContaining({
        symbol: 'GrantCapability',
        replacement: '@docket/identity-access/capabilities',
      }),
      expect.objectContaining({
        symbol: 'CAPABILITY_RANK',
        replacement: '@docket/identity-access/capabilities',
      }),
      expect.objectContaining({
        symbol: 'satisfies',
        replacement: '@docket/identity-access/capabilities',
      }),
      expect.objectContaining({
        symbol: 'GrantResourceKind',
        replacement: '@docket/identity-access/grants',
      }),
      expect.objectContaining({
        symbol: 'GrantSubjectKind',
        replacement: '@docket/identity-access/grants',
      }),
      expect.objectContaining({
        symbol: 'ActionSpec',
        replacement: '@docket/automation/contracts',
      }),
      expect.objectContaining({
        symbol: 'AutomationEventMatch',
        replacement: '@docket/automation/contracts',
      }),
      expect.objectContaining({
        symbol: 'AutomationRule',
        replacement: '@docket/automation/contracts',
      }),
      expect.objectContaining({
        symbol: 'Predicate',
        replacement: '@docket/automation/contracts',
      }),
      expect.objectContaining({
        symbol: 'PredicateLeafOp',
        replacement: '@docket/automation/contracts',
      }),
      expect.objectContaining({
        symbol: 'PredicateValue',
        replacement: '@docket/automation/contracts',
      }),
      expect.objectContaining({
        symbol: 'AutomationRule',
        replacement: '@docket/automation/contracts',
      }),
      expect.objectContaining({
        kind: 'namespace',
        symbol: '*',
        replacement: 'explicit public contract subpaths',
      }),
      expect.objectContaining({
        kind: 'export-star',
        symbol: '*',
        replacement: 'explicit public contract subpaths',
      }),
      expect.objectContaining({
        kind: 'import-type',
        symbol: 'NotionMirrorEntity',
        replacement: '@docket/connections/notion/mirror-contract',
      }),
      expect.objectContaining({
        kind: 'import-type',
        symbol: 'AutomationRule',
        replacement: '@docket/automation/contracts',
      }),
      expect.objectContaining({
        kind: 'import-type-namespace',
        symbol: '*',
        replacement: 'explicit public contract subpaths',
      }),
      expect.objectContaining({
        kind: 'dynamic-import',
        symbol: '*',
        replacement: 'explicit public contract subpaths',
      }),
      expect.objectContaining({
        kind: 'dynamic-import',
        symbol: '*',
        replacement: 'explicit public contract subpaths',
      }),
      expect.objectContaining({
        kind: 'require',
        symbol: '*',
        replacement: 'explicit public contract subpaths',
      }),
      expect.objectContaining({
        kind: 'import-equals',
        symbol: '*',
        replacement: 'explicit public contract subpaths',
      }),
    ]);
  });

  it('permits the Types Automation compatibility facade to forward from the owning domain', () => {
    const source = `
      import { AutomationRule } from '@docket/automation/contracts';

      export { AutomationRule };
    `;

    expect(
      migratedContractImportViolations(TYPES_AUTOMATION_COMPATIBILITY_FACADE_FIXTURE, source),
    ).toEqual([]);
  });

  it('guards legacy Automation grammar imports from every non-test Types module', () => {
    const source = `
      import { AutomationRule } from '@docket/types';

      export const automationRule = AutomationRule;
    `;

    for (const filePath of [
      TYPES_AUTOMATION_COMPATIBILITY_FACADE_FIXTURE,
      UNAPPROVED_TYPES_AUTOMATION_FIXTURE,
    ]) {
      expect(migratedContractImportViolations(filePath, source)).toEqual([
        expect.objectContaining({
          kind: 'named',
          symbol: 'AutomationRule',
          replacement: '@docket/automation/contracts',
        }),
      ]);
    }
    expect(migratedContractImportViolations(TEST_FIXTURE, source)).toEqual([]);
  });

  it('rejects opaque runtime module loaders that could reach legacy types through an alias', () => {
    const source = `
      const requireAlias = require;
      const aliasTypes = requireAlias('@docket/types');
      const moduleRequire = module.require;
      const moduleTypes = moduleRequire('@docket/types');
      const { require: destructuredModuleRequire } = module;
      const destructuredModuleTypes = destructuredModuleRequire('@docket/types');
      const { ['require']: destructuredGlobalRequire } = globalThis;
      const destructuredGlobalTypes = destructuredGlobalRequire('@docket/types');
      ({ require: assignedModuleRequire } = module);
      const assignedModuleTypes = assignedModuleRequire('@docket/types');
      ({ ['require']: assignedGlobalRequire } = globalThis);
      const assignedGlobalTypes = assignedGlobalRequire('@docket/types');
      const globalRequire = global.require;
      const globalTypes = globalRequire('@docket/types');
      const directGlobalTypes = global['require']('@docket/types');
      const moduleAlias = module;
      const aliasedModuleTypes = moduleAlias.require('@docket/types');
      let globalAlias;
      globalAlias = globalThis;
      const aliasedGlobalTypes = globalAlias.require('@docket/types');
      const computedTypes = await import('@docket/' + 'types');
      const computedRequiredTypes = require('@docket/' + 'types');
      const moduleFactory = await import('node:module');
    `;

    expect(migratedContractImportViolations(PRODUCTION_FIXTURE, source)).toEqual([
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({
        kind: 'dynamic-import',
        symbol: '*',
        replacement: WILDCARD_REPLACEMENT,
      }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({
        kind: 'dynamic-import',
        symbol: '*',
        replacement: WILDCARD_REPLACEMENT,
      }),
    ]);
  });

  it('rejects Node loader factories and legacy main-module loaders that can reach legacy types', () => {
    const source = `
      const builtinModule = process.getBuiltinModule('node:module');
      const builtinRequire = builtinModule.createRequire(import.meta.url);
      const builtinTypes = builtinRequire('@docket/types');
      const mainModuleTypes = process.mainModule.require('@docket/types');
    `;

    expect(migratedContractImportViolations(PRODUCTION_FIXTURE, source)).toEqual([
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
    ]);
  });

  it('rejects global and required process origins for Node loader factories that can reach legacy types', () => {
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

    expect(migratedContractImportViolations(PRODUCTION_FIXTURE, source)).toEqual([
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
    ]);
  });

  it('rejects a named node:process loader-factory import that can reach legacy types', () => {
    const source = `
      import { getBuiltinModule as loadBuiltinModule } from 'node:process';

      const legacyTypes = loadBuiltinModule('node:module')
        .createRequire(import.meta.url)('@docket/types');
    `;

    expect(migratedContractImportViolations(PRODUCTION_FIXTURE, source)).toEqual([
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
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

    expect(migratedContractImportViolations(PRODUCTION_FIXTURE, source)).toEqual([
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
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

    expect(migratedContractImportViolations(PRODUCTION_FIXTURE, source)).toEqual([
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
      expect.objectContaining({ kind: 'require', symbol: '*', replacement: WILDCARD_REPLACEMENT }),
    ]);
  });

  it('includes production build scripts and configuration entrypoints in the root scan', () => {
    const policyFiles = collectMigratedContractPolicyFiles().map(relativeToWorkspaceRoot);

    expect(policyFiles).toEqual(
      expect.arrayContaining([
        'apps/admin/next.config.ts',
        'apps/web/scripts/generate-offline-routes.ts',
        'scripts/ci-gate-policy.ts',
      ]),
    );
  });

  it('keeps migrated contracts out of every non-test production source', () => {
    const violations = collectMigratedContractPolicyFiles().flatMap((filePath) =>
      migratedContractImportViolations(filePath, readFileSync(filePath, 'utf8')),
    );

    expect(
      violations,
      violations
        .map((violation) => {
          const instruction =
            violation.kind === 'named'
              ? `import ${violation.symbol} from ${violation.replacement} instead.`
              : `replace the ${violation.kind} import with ${violation.replacement}.`;
          return `${violation.file}:${violation.line}:${violation.column} ${instruction}`;
        })
        .join('\n'),
    ).toEqual([]);
  });
});
