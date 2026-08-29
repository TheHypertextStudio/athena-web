import { cleanup, render, screen } from '@testing-library/react';
import type { MentionItem } from '@docket/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MentionMenu from '@/components/mentions/mention-menu';
import type { MentionSearchState } from '@/components/mentions/use-mention-search';

const state = vi.hoisted<{ current: MentionSearchState | null }>(() => ({ current: null }));

vi.mock('@/components/mentions/use-mention-search', () => ({
  useMentionSearch: (): MentionSearchState => {
    if (state.current === null) throw new Error('Mention search state was not installed.');
    return state.current;
  },
}));

afterEach(() => {
  cleanup();
  state.current = null;
});

/** Build one local result with the fields the real search endpoint returns. */
function item(entityKind: 'task' | 'project' | 'team', id: string, title: string): MentionItem {
  return {
    origin: 'local',
    id,
    ref: { kind: 'entity', entityKind, entityId: id },
    entityKind,
    title,
    subtitle: null,
    href: `/orgs/org_1/${entityKind}s/${id}`,
    score: 1,
  };
}

describe('MentionMenu group layout', () => {
  it('keeps every populated result group at content height instead of collapsing it to a divider', async () => {
    const task = item('task', 'task_1', 'Braindump all work');
    const project = item('project', 'project_1', 'Bus Buddies Pilot Season');
    const team = item('team', 'team_1', 'Public Engagement');
    state.current = {
      groups: [
        { key: 'task', label: 'Tasks', items: [task], hidden: 0 },
        { key: 'project', label: 'Projects', items: [project], hidden: 0 },
        { key: 'team', label: 'Teams', items: [team], hidden: 0 },
      ],
      items: [task, project, team],
      localPending: false,
      externalPending: false,
      localFailed: false,
      externalFailed: false,
    };

    render(
      <MentionMenu
        open
        orgId="org_1"
        anchorRef={{ current: { getBoundingClientRect: () => new DOMRect(40, 40, 1, 20) } }}
        activeKey={undefined}
        hasArrowed={false}
        listboxId="mention-results"
        query="b"
        onSelect={vi.fn()}
        onOpenChange={vi.fn()}
        onRows={vi.fn()}
      />,
    );

    const groups = await screen.findAllByRole('group');
    expect(groups).toHaveLength(3);
    for (const group of groups) {
      expect(group).not.toHaveClass('h-px');
      expect(group).not.toHaveClass('my-1.5');
    }
    expect(screen.getByRole('option', { name: /Braindump all work/ })).toBeVisible();
    expect(screen.getByRole('option', { name: /Bus Buddies Pilot Season/ })).toBeVisible();
    expect(screen.getByRole('option', { name: /Public Engagement/ })).toBeVisible();
    for (const option of screen.getAllByRole('option')) {
      expect(option).toHaveClass('min-h-10');
      expect(option).not.toHaveClass('min-h-11');
    }
  });

  it.each([
    { stateKey: 'externalPending', label: 'pending Files section' },
    { stateKey: 'externalFailed', label: 'failed Files section' },
  ] as const)('keeps the $label at content height', async ({ stateKey }) => {
    const project = item('project', 'project_1', 'Bus Buddies Pilot Season');
    state.current = {
      groups: [{ key: 'project', label: 'Projects', items: [project], hidden: 0 }],
      items: [project],
      localPending: false,
      externalPending: stateKey === 'externalPending',
      localFailed: false,
      externalFailed: stateKey === 'externalFailed',
    };

    render(
      <MentionMenu
        open
        orgId="org_1"
        anchorRef={{ current: { getBoundingClientRect: () => new DOMRect(40, 40, 1, 20) } }}
        activeKey={undefined}
        hasArrowed={false}
        listboxId="mention-results"
        query="bus"
        onSelect={vi.fn()}
        onOpenChange={vi.fn()}
        onRows={vi.fn()}
      />,
    );

    const files = await screen.findByText('Files', { exact: false });
    const section = files.closest('li');
    expect(section).not.toBeNull();
    expect(section).not.toHaveClass('h-px');
    expect(section?.querySelector(':scope > [aria-hidden].h-px')).not.toBeNull();
  });

  it('reserves the same 40px height while local results load', () => {
    state.current = {
      groups: [],
      items: [],
      localPending: true,
      externalPending: false,
      localFailed: false,
      externalFailed: false,
    };

    render(
      <MentionMenu
        open
        orgId="org_1"
        anchorRef={{ current: { getBoundingClientRect: () => new DOMRect(40, 40, 1, 20) } }}
        activeKey={undefined}
        hasArrowed={false}
        listboxId="mention-results"
        query="bus"
        onSelect={vi.fn()}
        onOpenChange={vi.fn()}
        onRows={vi.fn()}
      />,
    );

    const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons).toHaveLength(3);
    for (const skeleton of skeletons) expect(skeleton).toHaveClass('h-10');
  });
});
