declare module '*/tooling/eslint-config/plugin.js' {
  import type { Rule } from 'eslint';

  const plugin: {
    readonly rules: {
      readonly 'no-app-owned-columnheader': Rule.RuleModule;
    };
  };
  export default plugin;
}
