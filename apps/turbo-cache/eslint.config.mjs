import rootConfig from '../../eslint.config.js';

/** Keep generated native cf build outputs out of source linting. */
export default [{ ignores: ['.cloudflare/**', 'dist/**', 'coverage/**'] }, ...rootConfig];
