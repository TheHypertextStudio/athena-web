import Image from 'next/image';
import type { JSX } from 'react';

/** Props for a real Docket capture on the marketing site. */
export interface ProductScreenshotProps {
  readonly src: string;
  readonly alt: string;
  readonly aspect: string;
  readonly tone: 'paper' | 'ink';
  readonly position?: 'top' | 'center';
  readonly eager?: boolean;
}

/** Render a captured Docket view populated with disclosed example data. */
export function ProductScreenshot({
  src,
  alt,
  aspect,
  tone,
  position = 'top',
  eager = false,
}: ProductScreenshotProps): JSX.Element {
  const ink = tone === 'ink';
  return (
    <figure
      className={`relative overflow-hidden rounded-lg border ${aspect} ${
        ink ? 'border-paper/25 bg-paper/10' : 'border-ink/15 bg-paper-deep'
      }`}
    >
      <Image
        src={src}
        alt={alt}
        fill
        loading={eager ? 'eager' : 'lazy'}
        sizes="(min-width: 768px) 72rem, 100vw"
        className={`object-cover ${position === 'center' ? 'object-center' : 'object-top'}`}
      />
      <figcaption
        className={`text-label-small absolute right-2 bottom-2 rounded-sm border px-2 py-1 backdrop-blur-sm ${
          ink
            ? 'border-paper/25 bg-ink/80 text-paper/80'
            : 'border-ink/15 bg-paper/90 text-ink-muted'
        }`}
      >
        Example data
      </figcaption>
    </figure>
  );
}
