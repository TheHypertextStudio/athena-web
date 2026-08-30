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

/** Render a captured Docket view. */
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
    <div
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
    </div>
  );
}
