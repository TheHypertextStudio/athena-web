import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BlueprintPreviewConsequences } from '@/components/composer/blueprint-preview-consequences';
afterEach(cleanup);
describe('included-work preview consequences', () => {
  it('separates valid unassigned work, missing anchors and completion timing', () => {
    render(
      <BlueprintPreviewConsequences
        assignmentLocation="Work"
        warnings={[
          { code: 'actor_unavailable', paths: [['prepare']], count: 5 },
          { code: 'missing_anchor', paths: [['prepare']], count: 2 },
          { code: 'waiting_completion', paths: [['follow-up']], count: 1 },
        ]}
      />,
    );
    expect(screen.getByText('5 items will be unassigned.')).toBeVisible();
    expect(
      screen.getByText('2 items need a date anchor. Set their parent or milestone dates.'),
    ).toBeVisible();
    expect(
      screen.getByText('1 item will receive dates after prerequisite completion.'),
    ).toBeVisible();
    expect(screen.getByText('Set responsibility in Work to assign them.')).toBeVisible();
    expect(screen.queryByText(/affected fields or children/)).not.toBeInTheDocument();
  });
  it('bounds omitted metadata counts and renders no empty attention block', () => {
    const view = render(
      <BlueprintPreviewConsequences
        warnings={[{ code: 'label_unavailable', paths: [], count: 600 }]}
      />,
    );
    expect(screen.getByText('500+ items will omit unavailable labels.')).toBeVisible();
    view.rerender(<BlueprintPreviewConsequences warnings={[]} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
