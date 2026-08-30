/** Verify that a responsive audit matrix contains every named case and frame. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MOBILE_LAYOUT_ROUTE_CASES } from '../helpers/mobile-layout-audit-cases';

const FRAME_LABELS = [
  '1440x900-light',
  '1440x900-dark',
  '390x844-light',
  '390x844-dark',
  '320x844-light',
  '320x844-dark',
  '390x600-light',
  '390x600-dark',
] as const;

interface CaptureRecord {
  readonly caseId: string;
  readonly viewport: { readonly label: string };
  readonly colorScheme: 'light' | 'dark';
  readonly file: string;
}

/** Read and validate one line emitted by the capture runner. */
function parseRecord(line: string): CaptureRecord {
  const parsed: unknown = JSON.parse(line);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('caseId' in parsed) ||
    !('viewport' in parsed) ||
    !('colorScheme' in parsed) ||
    !('file' in parsed)
  ) {
    throw new Error(`mobile-layout-audit: invalid capture record ${line}`);
  }
  return parsed as CaptureRecord;
}

function parseFlag(argv: readonly string[], name: string): string | undefined {
  return argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const recordsPath = resolve(parseFlag(process.argv.slice(2), 'records') ?? 'audit-records.jsonl');
  if (!existsSync(recordsPath)) {
    throw new Error(`mobile-layout-audit: no capture records at ${recordsPath}`);
  }
  const records = readFileSync(recordsPath, 'utf8').split('\n').filter(Boolean).map(parseRecord);
  const expected = new Set(
    MOBILE_LAYOUT_ROUTE_CASES.flatMap((entry) =>
      FRAME_LABELS.map((frame) => `${entry.id}:${frame}`),
    ),
  );
  const actual = new Map<string, CaptureRecord>();
  for (const record of records) {
    const key = `${record.caseId}:${record.viewport.label}-${record.colorScheme}`;
    if (!expected.has(key)) throw new Error(`mobile-layout-audit: unexpected record ${key}`);
    if (actual.has(key)) throw new Error(`mobile-layout-audit: duplicate record ${key}`);
    if (!existsSync(record.file))
      throw new Error(`mobile-layout-audit: missing evidence ${record.file}`);
    actual.set(key, record);
  }
  const missing = [...expected].filter((key) => !actual.has(key));
  if (missing.length > 0) {
    throw new Error(
      `mobile-layout-audit: ${String(missing.length)} frames missing; first: ${missing.slice(0, 8).join(', ')}`,
    );
  }
  console.log(
    `[mobile-layout-audit] verified ${String(actual.size)} frames for ${String(MOBILE_LAYOUT_ROUTE_CASES.length)} cases`,
  );
}

main().catch((error: unknown) => {
  console.error('[mobile-layout-audit] failed:', error);
  process.exit(1);
});
