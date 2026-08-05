import '@testing-library/jest-dom/vitest';

import { describe, expect, it } from 'vitest';

import { statusGlyphType as cycleStatusGlyphType } from '@/components/cycles/cycle-status';
import {
  cycleStatusOptions,
  initiativeStatusOptions,
  programStatusOptions,
  projectStatusOptions,
} from '@/components/property-pickers/options';
import { statusGlyphType as programStatusGlyphType } from '@/components/programs/program-status';
import { statusGlyphType as projectStatusGlyphType } from '@/components/projects/project-status';

/** Read the `type` prop off a `<StatusIcon type={…} />` element without rendering it. */
function glyphType(icon: unknown): unknown {
  return (icon as { props?: { type?: unknown } }).props?.type;
}

/**
 * Every status picker whose lifecycle already has a leading glyph elsewhere in the product
 * (a Projects/Programs/Cycles list row) reuses that exact glyph on its picker rows, rather than
 * shipping a bare-text pill next to option rows that do carry one.
 *
 * @remarks
 * Initiative status is the deliberate exception: no `components/initiatives/*-status.tsx` glyph
 * mapping exists anywhere else in the app, so there is no icon to reuse without inventing one.
 * That test locks in the *absence* of an icon so a future glyph addition is a conscious choice,
 * not a silent gap.
 */
describe('status picker options reuse the row glyph, not a bare label', () => {
  it('gives every project status option the same StatusIcon its list row renders', () => {
    for (const option of projectStatusOptions()) {
      expect(option.icon, option.label).toBeTruthy();
      expect(glyphType(option.icon), option.label).toBe(projectStatusGlyphType(option.value));
    }
  });

  it('gives every program status option the same StatusIcon its list row renders', () => {
    for (const option of programStatusOptions()) {
      expect(option.icon, option.label).toBeTruthy();
      expect(glyphType(option.icon), option.label).toBe(programStatusGlyphType(option.value));
    }
  });

  it('gives every cycle status option the same StatusIcon a cycle row renders', () => {
    for (const option of cycleStatusOptions()) {
      expect(option.icon, option.label).toBeTruthy();
      expect(glyphType(option.icon), option.label).toBe(cycleStatusGlyphType(option.value));
    }
  });

  it('leaves initiative status options icon-less — no reusable glyph exists yet', () => {
    for (const option of initiativeStatusOptions()) {
      expect(option.icon, option.label).toBeUndefined();
    }
  });
});
