/**
 * PostCSS configuration for the Docket service-admin console.
 *
 * @remarks
 * Tailwind CSS v4 processes the design-token stylesheet (`@docket/ui` globals, pulled in
 * via `src/app/globals.css`) through the `@tailwindcss/postcss` plugin. This is the only
 * PostCSS step Tailwind v4 requires; `postcss-import` and `autoprefixer` are subsumed.
 *
 * Authored as `postcss.config.js` (ESM via the package's `"type": "module"`) so it matches
 * the workspace ESLint ignore for config files.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
