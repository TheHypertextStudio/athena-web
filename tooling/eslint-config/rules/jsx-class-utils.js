/** Shared, static JSX class inspection for Docket's ownership rules. */

/** Return a JSX element name without resolving an imported binding. */
export function jsxName(name) {
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression' && name.object.type === 'JSXIdentifier') {
    return `${name.object.name}.${jsxName(name.property)}`;
  }
  return null;
}

/** Return a static string from a literal or no-substitution template expression. */
export function staticString(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/** Gather every statically knowable string nested in an expression. */
export function staticStrings(node) {
  const direct = staticString(node);
  if (direct !== null) return [direct];
  if (!node) return [];

  if (node.type === 'ConditionalExpression') {
    return [...staticStrings(node.consequent), ...staticStrings(node.alternate)];
  }
  if (node.type === 'LogicalExpression') return staticStrings(node.right);
  if (node.type === 'ArrayExpression') return node.elements.flatMap((item) => staticStrings(item));
  // cn/cva and their aliases can only make static arguments conditional; examining the arguments
  // catches every literal branch while deliberately leaving arbitrary computed helpers alone.
  if (node.type === 'CallExpression')
    return node.arguments.flatMap((argument) => {
      return argument.type === 'SpreadElement'
        ? staticStrings(argument.argument)
        : staticStrings(argument);
    });
  return [];
}

/** Return all static class strings from a JSX `className` attribute. */
export function classStrings(attribute) {
  if (attribute.name?.name !== 'className') return [];
  if (!attribute.value) return [];
  if (attribute.value.type === 'JSXExpressionContainer')
    return staticStrings(attribute.value.expression);
  return staticStrings(attribute.value);
}

/** Return one static JSX attribute value, including object-literal spreads. */
export function staticAttributeValue(openingElement, name) {
  for (const attribute of openingElement.attributes) {
    if (attribute.type === 'JSXAttribute' && attribute.name.name === name) {
      if (!attribute.value) return true;
      return attribute.value.type === 'JSXExpressionContainer'
        ? staticLiteral(attribute.value.expression)
        : staticLiteral(attribute.value);
    }
    if (attribute.type === 'JSXSpreadAttribute' && attribute.argument.type === 'ObjectExpression') {
      for (const property of attribute.argument.properties) {
        if (property.type !== 'Property' || property.computed) continue;
        const key =
          property.key.type === 'Identifier' ? property.key.name : staticString(property.key);
        if (key === name) return staticLiteral(property.value);
      }
    }
  }
  return undefined;
}

/** Read only literal values. Dynamic values remain outside static lint enforcement. */
function staticLiteral(node) {
  if (node?.type === 'Literal') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

/** Split static Tailwind class strings into individual tokens. */
export function classTokens(openingElement) {
  return openingElement.attributes
    .filter((attribute) => attribute.type === 'JSXAttribute')
    .flatMap((attribute) => classStrings(attribute))
    .flatMap((value) => value.split(/\s+/u).filter(Boolean));
}

/** Strip Tailwind variant prefixes while retaining whether a state modifier was present. */
export function tailwindToken(token) {
  const parts = token.split(':');
  const base = parts.at(-1)?.replace(/^!/, '') ?? token;
  const modifiers = parts.slice(0, -1);
  const hasStateModifier = modifiers.some((modifier) =>
    /(?:^|[-[])(hover|focus|active|disabled|selected|open|closed|checked|pressed|invalid|group|peer|aria|data)(?:$|[-\]])/u.test(
      modifier,
    ),
  );
  return { base, hasStateModifier };
}

/** Return camelCase style keys from a statically declared JSX style object. */
export function styleProperties(openingElement) {
  const style = openingElement.attributes.find(
    (attribute) => attribute.type === 'JSXAttribute' && attribute.name.name === 'style',
  );
  if (!style?.value || style.value.type !== 'JSXExpressionContainer') return [];
  const expression = style.value.expression;
  if (expression.type !== 'ObjectExpression') return [];
  return expression.properties.flatMap((property) => {
    if (property.type !== 'Property' || property.computed) return [];
    const name =
      property.key.type === 'Identifier' ? property.key.name : staticString(property.key);
    return name ? [{ name, value: property.value }] : [];
  });
}
