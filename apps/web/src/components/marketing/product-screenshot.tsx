import Image from 'next/image';
import type { JSX } from 'react';

/** Props for a real Docket capture on the marketing site. */
export interface ProductScreenshotProps {
  /** Public asset path for the captured product view. */
  readonly src: string;
  /** Literal description of the product state visible in the image. */
  readonly alt: string;
  /** Aspect ratio class used by the surrounding section. */
  readonly aspect: string;
  /** Background behind the frame. */
  readonly tone: 'paper' | 'ink';
  /** Optional crop anchor for narrow marketing frames. */
  readonly position?: 'top' | 'center';
  /** Load immediately when the capture is the page's above-the-fold hero media. */
  readonly eager?: boolean;
}

/**
 * A screenshot of the running Docket application populated with disposable example data.
 *
 * @remarks
 * The visible label is part of the product claim: these are real application captures, but the
 * organizations and work were created for this page. Calling that out prevents plausible sample
 * records from being mistaken for customer data.
 *
 * @param props - Asset, accessible description, frame shape, background, and crop anchor.
 * @returns The framed screenshot and its example-data disclosure.
 */
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
      } shadow-[var(--mk-shadow-plate)]`}
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
        className={`absolute right-2 bottom-2 rounded-sm border px-2 py-1 font-mono text-[10px] tracking-wide backdrop-blur-sm ${
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
