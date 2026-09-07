import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { serializeDocumentFigure } from '@docket/markdown-tree';

import { StaticMarkdown } from '../../src/components/editor/static-markdown';

describe('semantic figure rendering', () => {
  it('renders the codec-owned figure, caption, credit, source, and license as semantic HTML', () => {
    const figure = serializeDocumentFigure({
      version: 1,
      src: '/v1/orgs/org-1/images/image-1',
      alt: 'Transit riders boarding a bus',
      decorative: false,
      caption: 'Riders board the Maryland Parkway bus.',
      creditText: 'Regional Transportation Commission',
      sourceUrl: 'https://example.com/photos/boarding',
      licenseText: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    });

    render(<StaticMarkdown value={figure} />);

    const image = screen.getByRole('img', { name: 'Transit riders boarding a bus' });
    const semanticFigure = image.closest('figure');
    if (semanticFigure === null) throw new Error('Expected a semantic figure.');
    expect(semanticFigure).toHaveAttribute('itemscope');
    expect(semanticFigure).toHaveAttribute('itemtype', 'https://schema.org/ImageObject');
    expect(image).toHaveAttribute('itemprop', 'contentUrl');
    expect(
      within(semanticFigure).getByText('Riders board the Maryland Parkway bus.'),
    ).toHaveAttribute('itemprop', 'caption');
    expect(within(semanticFigure).getByText('Regional Transportation Commission')).toHaveAttribute(
      'itemprop',
      'creditText',
    );
    expect(within(semanticFigure).getByRole('link', { name: 'Source' })).toHaveAttribute(
      'href',
      'https://example.com/photos/boarding',
    );
    const licenseLink = within(semanticFigure).getByRole('link', {
      name: 'CC BY 4.0',
    });
    if (!(licenseLink instanceof HTMLAnchorElement)) {
      throw new Error('The rendered license is not an anchor.');
    }
    expect(licenseLink.relList.contains('license')).toBe(true);
  });

  it('renders a decorative figure with an empty alt attribute', () => {
    const figure = serializeDocumentFigure({
      version: 1,
      src: '/v1/orgs/org-1/images/image-1',
      alt: 'Ignored authored text',
      decorative: true,
      caption: 'Decorative divider.',
    });

    const { container } = render(<StaticMarkdown value={figure} />);
    expect(container.querySelector('figure img')).toHaveAttribute('alt', '');
  });

  it('renders malformed or unsupported HTML as text instead of trusting it', () => {
    render(
      <StaticMarkdown
        value={'<figure data-docket-figure="1"><img src="javascript:alert(1)"></figure>'}
      />,
    );

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/data-docket-figure/)).toBeVisible();
  });

  it.each(['http://example.com/image.png', '//example.com/image.png', 'javascript:alert(1)'])(
    'does not fetch a legacy Markdown image from the unsafe source %s',
    (src) => {
      const { container } = render(<StaticMarkdown value={`![Unsafe image](${src})`} />);

      expect(container.querySelector('img')).toBeNull();
      expect(container).toHaveTextContent('Unsafe image');
    },
  );
});
