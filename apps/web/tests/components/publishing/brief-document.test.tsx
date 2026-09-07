import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { serializeDocumentFigure } from '@docket/markdown-tree';
import type { PublicBriefOut } from '@docket/work/publish-contract';
import { WorkEntityId } from '@docket/work/ids';

import { BriefDocument } from '../../../src/components/publishing/brief-document';

function briefWithDescription(description: string): PublicBriefOut {
  return {
    subjectKind: 'project',
    subjectId: WorkEntityId.parse('01J00000000000000000000000'),
    slug: 'route-redesign',
    workspaceSlug: 'rtc',
    workspaceName: 'RTC',
    vocabulary: { preset: 'startup' },
    title: 'Route redesign',
    summary: null,
    description,
    facts: [],
    sections: [],
    publishedAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
    canonicalUrl: null,
  };
}

describe('BriefDocument Markdown', () => {
  const figure = serializeDocumentFigure({
    version: 1,
    src: '/v1/orgs/org-1/images/image-1',
    alt: 'Route 109 bus',
    decorative: false,
    caption: 'The current Route 109 bus.',
    creditText: 'RTC',
  });

  it('renders full Markdown and rewrites a private image to the shared-host public route', () => {
    render(
      <BriefDocument
        brief={briefWithDescription(`# Service plan\n\n${figure}`)}
        imageRoute={{ kind: 'shared' }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Service plan', level: 1 })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Route 109 bus' })).toHaveAttribute(
      'src',
      '/v1/public/briefs/rtc/route-redesign/images/image-1',
    );
    expect(screen.getByText('The current Route 109 bus.')).toBeVisible();
  });

  it('includes the current host in a custom-domain public image route', () => {
    render(
      <BriefDocument
        brief={briefWithDescription(figure)}
        imageRoute={{ kind: 'domain', host: 'updates.example.com' }}
      />,
    );

    expect(screen.getByRole('img', { name: 'Route 109 bus' })).toHaveAttribute(
      'src',
      '/v1/public/briefs/domain/route-redesign/images/image-1?host=updates.example.com',
    );
  });

  it('preserves an existing remote HTTPS Markdown image', () => {
    render(
      <BriefDocument
        brief={briefWithDescription('![Remote diagram](https://images.example.com/diagram.png)')}
        imageRoute={{ kind: 'shared' }}
      />,
    );

    expect(screen.getByRole('img', { name: 'Remote diagram' })).toHaveAttribute(
      'src',
      'https://images.example.com/diagram.png',
    );
  });
});
