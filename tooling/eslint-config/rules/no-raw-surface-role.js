import { classTokens, styleProperties, tailwindToken } from './jsx-class-utils.js';

const SURFACE_BACKGROUND = /^bg-surface(?:-|$|\/)/u;
const SURFACE_VARIABLE = /var\(--color-surface(?:-container(?:-(?:lowest|low|high|highest))?)?\)/u;

/** Reject raw resting tonal choices outside the primitive that owns the role. */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require semantic owners for resting surface tones.' },
    schema: [],
    messages: {
      useSurface:
        'Use Surface, Card, surfaceToneColor, surfaceToneVariable, or an existing named domain surface for a resting region.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const rawClass = classTokens(node).some((token) => {
          const { base, hasStateModifier } = tailwindToken(token);
          return !hasStateModifier && SURFACE_BACKGROUND.test(base);
        });
        const rawStyle = styleProperties(node).some(({ value }) => {
          const literal =
            value.type === 'Literal' && typeof value.value === 'string' ? value.value : '';
          return SURFACE_VARIABLE.test(literal);
        });
        if (rawClass || rawStyle) context.report({ node, messageId: 'useSurface' });
      },
    };
  },
};
