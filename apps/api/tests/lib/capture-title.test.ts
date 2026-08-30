import { describe, expect, it } from 'vitest';

import { deriveCaptureTitle } from '../../src/lib/capture-title';

describe('deriveCaptureTitle', () => {
  it('takes the first non-empty line, collapsed and trimmed', () => {
    expect(deriveCaptureTitle('  Buy milk  \nand eggs')).toBe('Buy milk');
  });

  it('falls back to the whole placeholder-worthy text when every line is blank', () => {
    // `text.split('\n').find(...) ?? text` — the fallback side, reached only when every line is
    // whitespace-only, was never exercised; it degrades to the same "empty capture" title
    // `truncateTitle` already gives a bare empty string.
    expect(deriveCaptureTitle('   \n\t\n   ')).toBe('Follow up on an email');
  });
});
