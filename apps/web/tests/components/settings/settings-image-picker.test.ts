import { describe, expect, it } from 'vitest';

import {
  MAX_SETTINGS_IMAGE_BYTES,
  settingsImageFileError,
} from '../../../src/components/settings/settings-image-picker';

describe('settingsImageFileError', () => {
  it('accepts supported non-empty images within the size limit', () => {
    expect(settingsImageFileError({ type: 'image/png', size: 1024 })).toBeNull();
    expect(
      settingsImageFileError({ type: 'image/webp', size: MAX_SETTINGS_IMAGE_BYTES }),
    ).toBeNull();
  });

  it('rejects unsupported, oversized, and empty files with application-owned copy', () => {
    expect(settingsImageFileError({ type: 'image/svg+xml', size: 1024 })).toMatch(/JPG/);
    expect(
      settingsImageFileError({ type: 'image/jpeg', size: MAX_SETTINGS_IMAGE_BYTES + 1 }),
    ).toMatch(/smaller than 1 MB/);
    expect(settingsImageFileError({ type: 'image/gif', size: 0 })).toMatch(/empty/);
  });
});
