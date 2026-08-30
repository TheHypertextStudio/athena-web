/**
 * Regenerate `docs/engineering/specs/mcp-apps-conformance.md` from the committed spec copies.
 *
 * @remarks
 * Run after changing either the vendored specification or the claim registry:
 *
 * ```
 * pnpm --filter @docket/integrations exec tsx tests/mcp/emit-conformance-matrix.ts
 * ```
 *
 * `mcp-apps-conformance.test.ts` asserts the committed file is byte-identical to what this
 * produces, so a stale matrix fails CI rather than quietly describing a system that moved on.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSpecSources, renderConformanceMatrix } from './mcp-apps-conformance';

const target = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/engineering/specs/mcp-apps-conformance.md',
);

writeFileSync(target, renderConformanceMatrix(readSpecSources()));
process.stdout.write(`wrote ${target}\n`);
