/**
 * Render tests for the Vocabulary settings tab's personal-vs-org copy gate.
 *
 * @remarks
 * A personal workspace is the caller's own space, not an organization with other people in it, so
 * the tab must drop every org/multi-tenant framing — the directive's "no organization framing"
 * and "never show Teams" rules. These tests pin the user-visible contract the verifier checked
 * live: in a personal workspace the tab body shows zero "organization"/"your team"/"Teams"
 * wording and omits the `team` preview row, while a shared org keeps the unchanged org copy
 * (no regression).
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { VocabularyTab } from '../src/components/settings/vocabulary-tab';

afterEach(cleanup);

/** A no-op apply handler; these tests render copy, not the apply flow. */
function noopApply(): void {
  /* the apply flow is exercised elsewhere; here we only assert rendered copy */
}

/** Common props for the tab; the gate under test is `isPersonal`. */
const baseProps = {
  skin: null,
  canManage: true,
  applying: false,
  notice: null,
  noticeIsError: false,
  onApply: noopApply,
} as const;

/** The lowercased text content of a rendered element. */
function lowerText(el: HTMLElement): string {
  return el.textContent.toLowerCase();
}

describe('VocabularyTab personal workspace', () => {
  it('shows no organization / your-team / Teams wording in its body', () => {
    const { container } = render(<VocabularyTab {...baseProps} isPersonal />);
    const text = lowerText(container);
    expect(text).not.toContain('organization');
    expect(text).not.toContain('your team');
  });

  it('omits the multi-tenant Team / Teams preview row', () => {
    render(<VocabularyTab {...baseProps} isPersonal />);
    const preview = screen.getByRole('region', { name: 'Vocabulary preview' });
    // The `team` row is dropped; the always-present `task` row proves the preview still renders.
    expect(within(preview).queryByText('team')).toBeNull();
    expect(within(preview).getByText('task')).toBeTruthy();
  });

  it('frames the no-permission note as personal, not org', () => {
    render(<VocabularyTab {...baseProps} canManage={false} isPersonal />);
    const note = screen.getByText(/don’t have permission to change this vocabulary/i);
    expect(lowerText(note)).not.toContain('organization');
  });
});

describe('VocabularyTab shared org (no regression)', () => {
  it('keeps the organization framing and the Team preview row', () => {
    const { container } = render(<VocabularyTab {...baseProps} isPersonal={false} />);
    expect(lowerText(container)).toContain('organization');
    const preview = screen.getByRole('region', { name: 'Vocabulary preview' });
    expect(within(preview).getByText('team')).toBeTruthy();
  });

  it('defaults to the org framing when isPersonal is omitted', () => {
    const { container } = render(<VocabularyTab {...baseProps} />);
    expect(lowerText(container)).toContain('organization');
  });
});
