import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PageContextProvider,
  PageSource,
  buildPageContext,
  usePageContext,
} from '../../src/components/athena/page-context';

function Readout(): JSX.Element {
  const context = usePageContext();
  return <output data-testid="page-context">{JSON.stringify(context)}</output>;
}

function readContext(): unknown {
  return JSON.parse(screen.getByTestId('page-context').textContent);
}

afterEach(cleanup);

describe('buildPageContext', () => {
  it('returns null with neither a workspace nor a source', () => {
    expect(buildPageContext(null, null)).toBeNull();
  });

  it('omits an absent workspace name instead of writing undefined', () => {
    expect(buildPageContext({ workspaceId: 'ws_1' }, null)).toEqual({ workspaceId: 'ws_1' });
  });
});

describe('PageContextProvider', () => {
  it('reports null outside any workspace or page', () => {
    render(
      <PageContextProvider workspace={null}>
        <Readout />
      </PageContextProvider>,
    );
    expect(readContext()).toBeNull();
  });

  it('merges the shell workspace with a published page source', () => {
    render(
      <PageContextProvider workspace={{ workspaceId: 'ws_1', workspaceName: 'Harbor Health' }}>
        <PageSource type="project" id="project_1" label="Fall fundraiser launch" />
        <Readout />
      </PageContextProvider>,
    );
    expect(readContext()).toEqual({
      workspaceId: 'ws_1',
      workspaceName: 'Harbor Health',
      source: { type: 'project', id: 'project_1', label: 'Fall fundraiser launch' },
    });
  });

  it('clears the source when the page unmounts', () => {
    const view = render(
      <PageContextProvider workspace={{ workspaceId: 'ws_1' }}>
        <PageSource type="task" id="task_1" label="Confirm venue contract" />
        <Readout />
      </PageContextProvider>,
    );
    view.rerender(
      <PageContextProvider workspace={{ workspaceId: 'ws_1' }}>
        <Readout />
      </PageContextProvider>,
    );
    expect(readContext()).toEqual({ workspaceId: 'ws_1' });
  });

  it('lets a page publish without a provider', () => {
    expect(() => render(<PageSource type="task" id="task_1" />)).not.toThrow();
  });

  it('restores the previous page when a later publisher unmounts', () => {
    const view = render(
      <PageContextProvider workspace={null}>
        <PageSource type="task" id="task_1" label="Confirm venue contract" />
        <PageSource type="calendar_item" id="event_1" label="Standup" />
        <Readout />
      </PageContextProvider>,
    );
    expect(readContext()).toEqual({
      source: { type: 'calendar_item', id: 'event_1', label: 'Standup' },
    });

    view.rerender(
      <PageContextProvider workspace={null}>
        <PageSource type="task" id="task_1" label="Confirm venue contract" />
        <Readout />
      </PageContextProvider>,
    );
    expect(readContext()).toEqual({
      source: { type: 'task', id: 'task_1', label: 'Confirm venue contract' },
    });
  });

  it('keeps the source when only its label changes', () => {
    const onRender = vi.fn();
    function RecordingReadout(): JSX.Element {
      const context = usePageContext();
      onRender(context);
      return <output data-testid="page-context">{JSON.stringify(context)}</output>;
    }

    const view = render(
      <PageContextProvider workspace={null}>
        <PageSource type="task" id="task_1" />
        <RecordingReadout />
      </PageContextProvider>,
    );

    view.rerender(
      <PageContextProvider workspace={null}>
        <PageSource type="task" id="task_1" label="Confirm venue contract" />
        <RecordingReadout />
      </PageContextProvider>,
    );

    expect(readContext()).toEqual({
      source: { type: 'task', id: 'task_1', label: 'Confirm venue contract' },
    });

    const firstPublished = onRender.mock.calls.findIndex(
      ([context]) => context !== null && (context as { source?: unknown }).source !== undefined,
    );
    expect(firstPublished).toBeGreaterThanOrEqual(0);
    const afterFirstPublish = onRender.mock.calls.slice(firstPublished);
    expect(
      afterFirstPublish.every(
        ([context]) => context !== null && Boolean((context as { source?: unknown }).source),
      ),
    ).toBe(true);
  });
});
