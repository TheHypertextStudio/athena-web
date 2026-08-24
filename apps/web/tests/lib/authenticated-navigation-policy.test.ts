import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const webRoot = join(import.meta.dirname, '../..');
const roots = [join(webRoot, 'src/app/(app)'), join(webRoot, 'src/components')];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.tsx'].includes(extname(path)) ? [path] : [];
  });
}

function jsxAttribute(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  name: string,
): ts.JsxAttribute | undefined {
  return element.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

function staticAttributeValue(attribute: ts.JsxAttribute | undefined): string | null {
  if (!attribute?.initializer) return null;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    (ts.isStringLiteral(attribute.initializer.expression) ||
      ts.isNoSubstitutionTemplateLiteral(attribute.initializer.expression))
  ) {
    return attribute.initializer.expression.text;
  }
  return null;
}

function isFragmentExpression(attribute: ts.JsxAttribute | undefined): boolean {
  return Boolean(
    attribute?.initializer &&
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    ts.isTemplateExpression(attribute.initializer.expression) &&
    attribute.initializer.expression.head.text.startsWith('#'),
  );
}

function rawInternalAnchorLines(file: string): number[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    const element = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (element?.tagName.getText() === 'a') {
      const href = jsxAttribute(element, 'href');
      if (href) {
        const target = staticAttributeValue(jsxAttribute(element, 'target'));
        const value = staticAttributeValue(href);
        const explicitlyNative = [
          target === '_blank',
          jsxAttribute(element, 'download') !== undefined,
          jsxAttribute(element, 'data-native-navigation') !== undefined,
        ].some(Boolean);
        const staticallyExternal = value !== null && /^(?:https?:|mailto:|tel:|#)/u.test(value);
        if (!explicitlyNative && !staticallyExternal && !isFragmentExpression(href)) {
          lines.push(source.getLineAndCharacterOfPosition(element.getStart(source)).line + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

describe('authenticated navigation source policy', () => {
  it('keeps imperative Next routing behind the shared navigation seam', () => {
    const violations = roots
      .flatMap(sourceFiles)
      .filter((file) => readFileSync(file, 'utf8').includes("useRouter } from 'next/navigation'"))
      .map((file) => file.slice(webRoot.length + 1));

    expect(violations).toEqual([]);
  });

  it('requires authenticated components to name their exact generated route', () => {
    const violations = roots
      .flatMap(sourceFiles)
      .filter((file) => readFileSync(file, 'utf8').includes('useAppParams'))
      .map((file) => file.slice(webRoot.length + 1));

    expect(violations).toEqual([]);
  });

  it('keeps authenticated links behind DocketLink', () => {
    const violations = roots
      .flatMap(sourceFiles)
      .filter((file) => !file.includes('/components/marketing/'))
      .filter((file) => !file.endsWith('/components/docket-link.tsx'))
      .filter((file) => readFileSync(file, 'utf8').includes("from 'next/link'"))
      .map((file) => file.slice(webRoot.length + 1));

    expect(violations).toEqual([]);
  });

  it('rejects raw anchors unless their destination is explicitly external', () => {
    const violations = roots
      .flatMap(sourceFiles)
      .filter((file) => !file.includes('/components/marketing/'))
      .flatMap((file) =>
        rawInternalAnchorLines(file).map(
          (line) => `${file.slice(webRoot.length + 1)}:${String(line)}`,
        ),
      );

    expect(violations).toEqual([]);
  });
});
