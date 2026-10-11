import { fileURLToPath } from 'node:url';

import studioBrowser from '@thehypertextstudio/web-config/eslint/browser';

import docket from '../../eslint.config.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

// Product policy paths and the existing complexity ledger are relative to the repository root.
// Keep that base when composing the company baseline from this frontend-owned config.
export default [
  ...studioBrowser,
  ...docket.map((entry) => (entry.files ? { ...entry, basePath: repositoryRoot } : entry)),
];
