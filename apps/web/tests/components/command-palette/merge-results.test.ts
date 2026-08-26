import { describe, expect, it, vi } from 'vitest';

import { mergePaletteResults } from '@/components/command-palette/merge-results';
import type { PaletteItem } from '@/components/command-palette/types';
import { Settings } from '@docket/ui/icons';

function item(id: string, label: string, input: Partial<PaletteItem> = {}): PaletteItem {
  return {
    id,
    section: 'navigation',
    label,
    icon: Settings,
    run: vi.fn(),
    ...input,
  };
}

describe('mergePaletteResults', () => {
  it('puts every typed-query result in one relevance-ordered section', () => {
    const merged = mergePaletteResults(
      [
        item('setting:security', 'Security', {
          description: 'Manage passkeys and active sessions.',
        }),
      ],
      [
        item('task:review', 'Quarterly review', {
          description: 'Review the security program.',
          searchScore: 10,
        }),
      ],
      'security',
    );

    expect(merged.map((result) => result.id)).toEqual(['setting:security', 'task:review']);
    expect(merged.every((result) => result.section === 'results')).toBe(true);
  });
});
