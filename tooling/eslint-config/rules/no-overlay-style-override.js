import { classTokens, jsxName, styleProperties, tailwindToken } from './jsx-class-utils.js';

const CONTENT_SHELL = /^(Dialog|Sheet|Popover|DropdownMenu|ContextMenu|HoverCard|Tooltip)Content$/u;
const SECTION_SHELL = /^(Dialog|Sheet|Popover)(Header|Body|Footer)$/u;
const CONTROLLED_CLASS =
  /^(?:fixed|absolute|relative|sticky|inset-|top-|right-|bottom-|left-|w-|min-w-|max-w-|h-|min-h-|max-h-|overflow-|bg-|border(?:-|$)|rounded(?:-|$)|shadow(?:-|$)|z-|translate-|scale-|rotate-|transform$|p(?:x|y|t|r|b|l)?-)/u;
const SECTION_CONTROLLED_CLASS =
  /^(?:fixed|absolute|relative|sticky|inset-|top-|right-|bottom-|left-|overflow-|bg-|rounded(?:-|$)|p(?:x|y|t|r|b|l)?-)/u;
const SECTION_MARGIN = /^m(?:x|y|t|r|b|l)?-/u;
const CONTROLLED_STYLE =
  /^(?:position|inset|top|right|bottom|left|width|minWidth|maxWidth|height|minHeight|maxHeight|transform|overflow|background|backgroundColor|border|borderRadius|boxShadow|zIndex|padding)/u;

function primitiveSource(source) {
  return source === '@docket/ui/primitives' || /(?:^|\/)primitives(?:\/|$)/u.test(source);
}

/** Resolve only genuine shared primitive imports, preserving unrelated local component names. */
function importedPrimitive(opening, imports, namespaces) {
  const name = jsxName(opening.name);
  if (!name) return null;
  if (name.includes('.')) {
    const [namespace, exported] = name.split('.');
    return namespaces.has(namespace) ? exported : null;
  }
  return imports.get(name) ?? null;
}

/** Reject visual shell geometry supplied by a product call site. */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Keep shared overlay geometry inside typed presentations.' },
    schema: [],
    messages: {
      usePresentation:
        'Select the shared overlay presentation, size, or height variant instead of overriding panel geometry.',
      useSection:
        'Keep overlay section padding, margin, and overflow inside the shared Header, Body, or Footer API.',
    },
  },
  create(context) {
    const imports = new Map();
    const namespaces = new Set();
    return {
      ImportDeclaration(node) {
        if (!primitiveSource(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier')
            imports.set(specifier.local.name, specifier.imported.name);
          if (specifier.type === 'ImportNamespaceSpecifier') namespaces.add(specifier.local.name);
        }
      },
      JSXOpeningElement(node) {
        const component = importedPrimitive(node, imports, namespaces);
        if (!component || (!CONTENT_SHELL.test(component) && !SECTION_SHELL.test(component)))
          return;
        const section = SECTION_SHELL.test(component);
        const invalidClass = classTokens(node).some((token) => {
          const { base } = tailwindToken(token);
          const controlled = section ? SECTION_CONTROLLED_CLASS : CONTROLLED_CLASS;
          return controlled.test(base) || (section && SECTION_MARGIN.test(base));
        });
        const invalidStyle = styleProperties(node).some(({ name }) => CONTROLLED_STYLE.test(name));
        if (invalidClass || invalidStyle) {
          context.report({ node, messageId: section ? 'useSection' : 'usePresentation' });
        }
      },
    };
  },
};
