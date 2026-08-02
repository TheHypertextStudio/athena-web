/**
 * Recompute the SHA-256 digests in `docs/engineering/specs/vendor/sources.json`.
 *
 * @remarks
 * Run after replacing a vendored specification copy with a freshly downloaded one. The digests
 * are what let the conformance suite assert that the committed text has not been edited to agree
 * with the implementation; regenerating them is therefore a deliberate act, never a side effect
 * of a test run.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readSpecSources, VENDOR_DIR } from './mcp-apps-conformance';

const sources = readSpecSources();
const files = Object.fromEntries(
  Object.entries(sources.files).map(([name, record]) => [
    name,
    {
      ...record,
      sha256: createHash('sha256')
        .update(readFileSync(join(VENDOR_DIR, name)))
        .digest('hex'),
    },
  ]),
);

const updated = { ...sources, files };
writeFileSync(join(VENDOR_DIR, 'sources.json'), `${JSON.stringify(updated, null, 2)}\n`);
process.stdout.write(`updated ${String(Object.keys(files).length)} digests\n`);
