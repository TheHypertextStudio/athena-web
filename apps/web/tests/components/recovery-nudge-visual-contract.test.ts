import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../');
const bannerPath = join(root, 'apps/web/src/components/recovery-nudge-banner.tsx');

function source(): string {
  return readFileSync(bannerPath, 'utf8');
}

describe('Recovery nudge visual contract', () => {
  it('groups the message and action away from the isolated dismiss control', () => {
    const banner = source();
    expect(banner).toContain('grid-cols-[2.5rem_minmax(0,1fr)_2.5rem]');
    expect(banner).toContain('className="min-w-0 py-2"');
    expect(banner).toContain('className="text-body-medium"');
    expect(banner).toContain('mt-1 inline-flex min-h-10 items-center pr-3');
    expect(banner).not.toContain('flex items-center gap-3 rounded-xl');
  });

  it('keeps icon columns and the dismiss action aligned to 40-pixel areas', () => {
    const banner = source();
    expect(banner).toContain('flex size-10 items-center justify-center');
    expect(banner).toContain('flex size-10 shrink-0 items-center justify-center');
  });
});
