import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VocabularyProvider } from '@docket/ui/hooks';
import { OccurrenceOut } from '../../src/lib/contracts/recurrence';
import { OccurrenceRows } from '../../src/components/recurrence/series-occurrence-rows';

afterEach(cleanup);

const projectId = '01BX5ZZKBKACTAV9WEVGEMMVRJ';
const occurrence = OccurrenceOut.parse({
  id: '01BX5ZZKBKACTAV9WEVGEMMVRG',
  seriesId: '01BX5ZZKBKACTAV9WEVGEMMVRE',
  scheduledFor: '2026-08-10',
  originalScheduledFor: null,
  status: 'completed',
  processInstanceId: '01BX5ZZKBKACTAV9WEVGEMMVRH',
  taskId: '01BX5ZZKBKACTAV9WEVGEMMVRK',
  resolvedAt: null,
});

describe('generated occurrence navigation', () => {
  it.each([occurrence.taskId, null])(
    'opens the generated project with task reference %s',
    (taskId) => {
      render(
        <OccurrenceRows
          orgId="workspace"
          items={[OccurrenceOut.parse({ ...occurrence, taskId, projectId })]}
        />,
      );
      expect(screen.getByRole('link', { name: 'Open project' })).toHaveAttribute(
        'href',
        `/orgs/workspace/projects/${projectId}`,
      );
      expect(screen.queryByRole('link', { name: 'Open task' })).not.toBeInTheDocument();
    },
  );

  it('retains ordinary task links and uses the workspace vocabulary', () => {
    render(
      <VocabularyProvider
        skin={{ preset: 'startup', overrides: { task: { singular: 'Action', plural: 'Actions' } } }}
      >
        <OccurrenceRows orgId="workspace" items={[occurrence]} />
      </VocabularyProvider>,
    );
    expect(screen.getByRole('link', { name: 'Open action' })).toHaveAttribute(
      'href',
      `/orgs/workspace/tasks/${occurrence.taskId}`,
    );
  });

  it('does not invent a destination for an occurrence without visible work', () => {
    render(<OccurrenceRows orgId="workspace" items={[{ ...occurrence, taskId: null }]} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
