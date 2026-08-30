/** Reject client query imports from a Server Component route module. */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Keep client query hooks out of Server Component route modules.' },
    schema: [],
    messages: {
      useServerQuery:
        'Server route modules must use server-safe query helpers. Move client query hooks into a client component or import from @/lib/query-server.',
    },
  },
  create(context) {
    let clientModule = false;
    return {
      Program(node) {
        clientModule = node.body.some(
          (statement) =>
            statement.type === 'ExpressionStatement' && statement.directive === 'use client',
        );
      },
      ImportDeclaration(node) {
        if (clientModule || node.source.value !== '@/lib/query') return;
        context.report({ node, messageId: 'useServerQuery' });
      },
    };
  },
};
