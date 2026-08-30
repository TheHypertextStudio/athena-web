import { classTokens, jsxName, staticAttributeValue } from './jsx-class-utils.js';

const FORBIDDEN_ROLES = new Set(['dialog', 'alertdialog', 'menu', 'menuitem']);

/** Reject product-owned overlay semantics that duplicate the shared primitives. */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require shared Dialog, Sheet, and menu presentations.' },
    schema: [],
    messages: {
      usePresentation:
        'Use the typed Dialog, Sheet, DropdownMenu, or ContextMenu presentation instead of bespoke overlay infrastructure.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier' || !/^[a-z]/u.test(node.name.name)) return;
        const role = staticAttributeValue(node, 'role');
        const ariaModal = staticAttributeValue(node, 'aria-modal');
        const tokens = classTokens(node).map((token) => token.replace(/^!/, ''));
        const fullscreenBackdrop =
          tokens.includes('fixed') &&
          (tokens.includes('inset-0') ||
            (tokens.includes('inset-x-0') && tokens.includes('inset-y-0')));
        if (
          FORBIDDEN_ROLES.has(role) ||
          ariaModal === true ||
          ariaModal === 'true' ||
          fullscreenBackdrop
        ) {
          context.report({ node, messageId: 'usePresentation' });
        }
      },
    };
  },
};
