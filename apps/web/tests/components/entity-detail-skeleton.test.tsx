/**
 * The detail-page loading state, and whether it is actually the page it precedes.
 *
 * @remarks
 * The failure this guards against is not a missing placeholder — every detail page had one. It
 * was that the placeholder and the page were built separately and drifted, so content jumped
 * into position when the read resolved. These tests assert the two share their structure rather
 * than merely looking similar, which is only true while the skeleton keeps composing the real
 * layout instead of re-drawing an approximation of it.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TaskDetailLoading } from '../../src/components/task-detail/task-detail-loading';
import { EntityDetailLayout } from '../../src/components/views/entity-detail-layout';
import { EntityDetailSkeleton } from '../../src/components/views/entity-detail-skeleton';

/** The structural anchors the layout owns: page measure, sticky header, and body region. */
function structureOf(container: HTMLElement): {
  scroller: boolean;
  header: boolean;
  body: boolean;
  scrollerClasses: string;
} {
  const scroller = container.querySelector('[data-detail-panel-scroll]');
  return {
    scroller: scroller !== null,
    header: container.querySelector('header') !== null,
    body: container.querySelector('.detail-body') !== null,
    scrollerClasses: scroller?.className ?? '',
  };
}

/** The loaded page, rendered with ordinary content in every slot. */
function renderLoaded() {
  return render(
    <EntityDetailLayout
      eyebrow={<span>Platform</span>}
      icon={<span>icon</span>}
      title="Rewrite onboarding"
      subtitle="Cut time-to-first-task in half"
      metadata={<div>properties</div>}
      tabs={<div>tabs</div>}
    >
      <div>panel</div>
    </EntityDetailLayout>,
  );
}

describe('EntityDetailSkeleton', () => {
  it('renders the same structural regions as the loaded page', () => {
    const loading = render(<EntityDetailSkeleton entityName="Project" />);
    const loaded = renderLoaded();

    const before = structureOf(loading.container);
    expect(before).toMatchObject({ scroller: true, header: true, body: true });
    // Identical container geometry is what removes the jump: same page measure, same sticky
    // header, same body region — so only the contents change when the read resolves.
    expect(before.scrollerClasses).toBe(structureOf(loaded.container).scrollerClasses);
  });

  it('owns the page scroll the same way the loaded page does', () => {
    const { container } = render(<EntityDetailSkeleton entityName="Project" />);

    // The loaded page takes the scroll from the shell. A placeholder that does not hands it back
    // on resolve, and the shell's reserved scrollbar gutter appears and disappears with it.
    expect(container.querySelector('[data-detail-panel-scroll]')).not.toBeNull();
  });

  it('announces itself as busy for assistive tech', () => {
    const { getByRole, queryByText } = render(<EntityDetailSkeleton entityName="Project" />);

    const status = getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.getAttribute('aria-label')).toBe('Project detail');
    expect(queryByText(/loading project/i)).toBeNull();
  });

  it('reserves a tab bar, which the old placeholders omitted entirely', () => {
    const { container } = render(<EntityDetailSkeleton entityName="Project" tabCount={3} />);

    const header = container.querySelector('header');
    // Every detail page has tabs; a placeholder without them is shorter than the page it
    // precedes, so the body slides up the moment the real tab bar appears.
    expect(header?.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3);
  });

  it('shows the real name once it is known instead of a placeholder bar', () => {
    const { container, queryByText } = render(
      <EntityDetailSkeleton entityName="Initiative" title="Reduce churn" />,
    );

    expect(queryByText('Reduce churn')).not.toBeNull();
    // The title slot specifically stops being a placeholder; the rest of the page still is.
    expect(container.querySelector('.detail-title [data-slot="skeleton"]')).toBeNull();
  });

  it('falls back to a placeholder title when the name is not known yet', () => {
    const { container } = render(<EntityDetailSkeleton entityName="Initiative" />);

    expect(container.querySelector('.detail-title [data-slot="skeleton"]')).not.toBeNull();
  });

  it('keeps the Task layout busy without rendering loading copy', () => {
    const { getByRole, queryByText } = render(<TaskDetailLoading />);

    expect(getByRole('status')).toHaveAttribute('aria-label', 'Task detail');
    expect(queryByText(/loading task/i)).toBeNull();
  });
});
