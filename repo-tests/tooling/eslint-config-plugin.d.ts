/**
 * Ambient types for the shared ESLint plugin, which is authored as plain JavaScript.
 *
 * `tooling/eslint-config/**` is deliberately outside every tsconfig and outside the lint preset's
 * own file patterns — its rules run inside ESLint, which needs no build step, and the type-aware
 * parser cannot resolve files that belong to no TypeScript program. This declaration exists purely
 * so the rule-behavior suite beside it can import the plugin under the repository-root program.
 */
declare module '*/tooling/eslint-config/plugin.js' {
  import type { Rule } from 'eslint';

  const plugin: {
    readonly rules: {
      readonly 'no-bespoke-overlay': Rule.RuleModule;
      readonly 'no-overlay-style-override': Rule.RuleModule;
      readonly 'no-raw-surface-role': Rule.RuleModule;
      readonly 'no-server-query-import': Rule.RuleModule;
    };
  };
  export default plugin;
}
