const COLUMNHEADER = 'columnheader';

/** Resolve a lexical identifier to the initializer that supplies its value. */
function identifierInitializer(identifier, sourceCode) {
  let scope = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) {
      const definition = variable.defs.find((candidate) => candidate.type === 'Variable');
      return definition?.node.init;
    }
    scope = scope.upper;
  }
  return undefined;
}

/** Strip TypeScript wrappers that do not change a role value at runtime. */
function unwrapExpression(expression) {
  if (
    expression.type === 'TSAsExpression' ||
    expression.type === 'TSTypeAssertion' ||
    expression.type === 'TSNonNullExpression'
  ) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

/** Resolve a template whose interpolations are all static strings. */
function templateValue(template, sourceCode, seen) {
  let value = template.quasis[0]?.value.cooked ?? '';
  for (const [index, expression] of template.expressions.entries()) {
    const resolved = staticString(expression, sourceCode, seen);
    if (resolved === undefined) return undefined;
    value += resolved;
    value += template.quasis[index + 1]?.value.cooked ?? '';
  }
  return value;
}

/** Resolve a string expression when the source proves its value. */
function staticString(rawExpression, sourceCode, seen) {
  const expression = unwrapExpression(rawExpression);
  if (expression.type === 'Literal') {
    return typeof expression.value === 'string' ? expression.value : undefined;
  }
  if (expression.type === 'TemplateLiteral') return templateValue(expression, sourceCode, seen);
  if (expression.type !== 'Identifier' || expression.name === 'undefined') return undefined;
  if (seen.has(expression)) return undefined;
  const initializer = identifierInitializer(expression, sourceCode);
  if (initializer === undefined) return undefined;
  seen.add(expression);
  return staticString(initializer, sourceCode, seen);
}

/** Identify an expression that can supply the reserved columnheader role. */
function mayBeColumnheader(rawExpression, sourceCode, seen = new Set()) {
  const expression = unwrapExpression(rawExpression);
  const resolved = staticString(expression, sourceCode, seen);
  if (resolved !== undefined) return resolved === COLUMNHEADER;
  if (expression.type === 'Identifier') return expression.name !== 'undefined';
  if (expression.type === 'ConditionalExpression') {
    return (
      mayBeColumnheader(expression.consequent, sourceCode, seen) ||
      mayBeColumnheader(expression.alternate, sourceCode, seen)
    );
  }
  if (expression.type === 'LogicalExpression') {
    return (
      mayBeColumnheader(expression.left, sourceCode, seen) ||
      mayBeColumnheader(expression.right, sourceCode, seen)
    );
  }
  return expression.type !== 'Literal';
}

/** Read an object property name without executing computed application code. */
function propertyName(property) {
  if (!property.computed && property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') {
    return property.key.value;
  }
  if (property.key.type === 'TemplateLiteral' && property.key.expressions.length === 0) {
    return property.key.quasis[0]?.value.cooked;
  }
  return undefined;
}

/** Classify whether an object definitely, possibly, or cannot provide the reserved role. */
function objectColumnheaderRisk(rawExpression, sourceCode, seen = new Set()) {
  const expression = unwrapExpression(rawExpression);
  if (expression.type === 'Identifier') {
    if (expression.name === 'undefined') return 'safe';
    if (seen.has(expression)) return 'unknown';
    const initializer = identifierInitializer(expression, sourceCode);
    if (initializer === undefined) return 'unknown';
    seen.add(expression);
    return objectColumnheaderRisk(initializer, sourceCode, seen);
  }
  if (expression.type === 'ConditionalExpression') {
    const consequent = objectColumnheaderRisk(expression.consequent, sourceCode, seen);
    const alternate = objectColumnheaderRisk(expression.alternate, sourceCode, seen);
    if (consequent === 'columnheader' || alternate === 'columnheader') return 'columnheader';
    return consequent === 'unknown' || alternate === 'unknown' ? 'unknown' : 'safe';
  }
  if (expression.type === 'Literal') return 'safe';
  if (expression.type !== 'ObjectExpression') return 'unknown';
  let risk = 'safe';
  for (const property of expression.properties) {
    if (property.type === 'SpreadElement') {
      const spreadRisk = objectColumnheaderRisk(property.argument, sourceCode, seen);
      if (spreadRisk === 'columnheader') return spreadRisk;
      if (spreadRisk === 'unknown') risk = spreadRisk;
      continue;
    }
    if (
      property.kind === 'init' &&
      propertyName(property) === 'role' &&
      mayBeColumnheader(property.value, sourceCode)
    ) {
      return 'columnheader';
    }
  }
  return risk;
}

/** Name the function that owns an intrinsic element so exemptions stay component-specific. */
function containingFunctionName(node) {
  let current = node.parent;
  while (current != null) {
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression'
    ) {
      if ('id' in current && current.id?.type === 'Identifier') return current.id.name;
      let owner = current.parent;
      while (owner?.type === 'CallExpression') owner = owner.parent;
      if (owner?.type === 'VariableDeclarator' && owner.id.type === 'Identifier') {
        return owner.id.name;
      }
      return undefined;
    }
    current = current.parent;
  }
  return undefined;
}

/** Return whether a named generic component may forward an unresolved role prop. */
function allowsUnknownPassthrough(node, allowedNames) {
  const name = containingFunctionName(node);
  return name !== undefined && allowedNames.has(name);
}

/** Identify React's two supported element-construction call shapes. */
function isCreateElementCall(call) {
  if (call.callee.type === 'Identifier') return call.callee.name === 'createElement';
  return (
    call.callee.type === 'MemberExpression' &&
    !call.callee.computed &&
    call.callee.object.type === 'Identifier' &&
    call.callee.object.name === 'React' &&
    call.callee.property.type === 'Identifier' &&
    call.callee.property.name === 'createElement'
  );
}

/** Return whether a JSX tag names a platform element instead of a React component. */
function isIntrinsicElementName(name) {
  return (
    name.type === 'JSXIdentifier' &&
    name.name.length > 0 &&
    name.name[0] === name.name[0]?.toLowerCase()
  );
}

/** Return whether createElement receives a literal platform tag as its first argument. */
function createsIntrinsicElement(call) {
  const element = call.arguments[0];
  return element?.type === 'Literal' && typeof element.value === 'string';
}

/** Reserve column-header semantics for the shared EntityTable implementation. */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require EntityTable to own application roster column headers.' },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allowPassthroughIn: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            uniqueItems: true,
          },
        },
      },
    ],
    messages: {
      useEntityTable: 'Use EntityTable instead of an application-owned column header.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const allowedNames = new Set(context.options[0]?.allowPassthroughIn ?? []);
    return {
      JSXOpeningElement(node) {
        if (!isIntrinsicElementName(node.name)) return;
        const ownsHeader = node.attributes.some((attribute) => {
          if (attribute.type === 'JSXSpreadAttribute') {
            const risk = objectColumnheaderRisk(attribute.argument, sourceCode);
            return (
              risk === 'columnheader' ||
              (risk === 'unknown' && !allowsUnknownPassthrough(node, allowedNames))
            );
          }
          if (attribute.name.type !== 'JSXIdentifier' || attribute.name.name !== 'role') {
            return false;
          }
          if (attribute.value?.type === 'Literal') {
            return attribute.value.value === COLUMNHEADER;
          }
          if (attribute.value?.type === 'JSXExpressionContainer') {
            return mayBeColumnheader(attribute.value.expression, sourceCode);
          }
          return false;
        });
        if (ownsHeader) context.report({ node, messageId: 'useEntityTable' });
      },
      CallExpression(node) {
        if (!isCreateElementCall(node) || !createsIntrinsicElement(node)) return;
        const properties = node.arguments[1];
        if (properties === undefined) return;
        const risk = objectColumnheaderRisk(properties, sourceCode);
        if (
          risk === 'columnheader' ||
          (risk === 'unknown' && !allowsUnknownPassthrough(node, allowedNames))
        ) {
          context.report({ node, messageId: 'useEntityTable' });
        }
      },
    };
  },
};
