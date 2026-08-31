export default {
  // `--no-warn-ignored`: the shared preset deliberately ignores `*.config.ts`, `*.config.js` and
  // `tooling/**` (they belong to no tsconfig, so the type-aware parser cannot resolve them). ESLint
  // reports each ignored file it was handed as a *warning*, and `--max-warnings=0` turns that into
  // a failed commit — so staging any config file blocked the commit with nothing actually wrong.
  '*.{ts,tsx}': ['prettier --write', 'eslint --max-warnings=0 --no-warn-ignored'],
  '*.{json,md,yaml,yml}': ['prettier --write'],
};
