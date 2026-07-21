import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../');
const bannerPath = join(root, 'apps/web/src/components/recovery-nudge-banner.tsx');

function source(): string {
  return readFileSync(bannerPath, 'utf8');
}

describe('Recovery nudge visual contract', () => {
  it('is a compact, borderless tonal card sized for the sidebar footer', () => {
    const banner = source();
    // A tonal container (surface step, no border) rather than the old full-width 3-column strip.
    expect(banner).toContain('bg-surface-container-high');
    expect(banner).toContain('rounded-lg');
    expect(banner).not.toContain('grid-cols-[2.5rem_minmax(0,1fr)_2.5rem]');
    expect(banner).not.toContain('px-4 pt-4');
  });

  it('keeps the message, an isolated dismiss, and the action link', () => {
    const banner = source();
    // A dedicated dismiss control, distinct from the action link into Security.
    expect(banner).toContain('aria-label="Dismiss"');
    expect(banner).toContain('sectionHref(personalOrgId,');
  });
});
