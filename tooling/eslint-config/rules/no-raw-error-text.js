import { classTokens, jsxName, staticAttributeValue, tailwindToken } from './jsx-class-utils.js';

/**
 * An error-role colour painted by hand: `text-error`, `bg-error-container`, `border-error/40`, …
 * A state modifier does not exempt it — an error tint on hover is still an error tint.
 */
const ERROR_UTILITY = /^(?:text|bg|border|ring|outline|fill|stroke)-error(?:-container)?(?:\/|$)/u;

/** Route failures through the feedback primitives instead of painting error state by hand. */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Present failures through Field error, FieldError, InlineBanner, LoadFailure, or a notice, never as hand-painted error text.',
    },
    schema: [],
    messages: {
      errorUtility:
        'Do not paint error state with a raw error token. Use Field error=, FieldError, InlineBanner tone="critical", LoadFailure, or presentFailure. See docs/engineering/specs/error-presentation.md.',
      rawAlert:
        'Do not hand-roll role="alert". Use FieldError, InlineBanner, LoadFailure, or a notice. See docs/engineering/specs/error-presentation.md.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const painted = classTokens(node).some((token) =>
          ERROR_UTILITY.test(tailwindToken(token).base),
        );
        if (painted) context.report({ node, messageId: 'errorUtility' });

        const name = jsxName(node.name);
        const intrinsic = name !== null && /^[a-z]/u.test(name);
        if (intrinsic && staticAttributeValue(node, 'role') === 'alert') {
          context.report({ node, messageId: 'rawAlert' });
        }
      },
    };
  },
};
