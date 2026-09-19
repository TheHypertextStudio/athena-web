'use client';

import { cn } from '@docket/ui/lib/utils';
import { Surface } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

/** The vertical rhythm between a section's heading and its content. */
const SECTION_GAP = { 2: 'gap-2', 3: 'gap-3', 4: 'gap-4' } as const;

/** How a heading lines up with the control at its end. */
const HEADER_ALIGN = { baseline: 'items-baseline', center: 'items-center' } as const;

/** Props for {@link TaskSection}. */
export interface TaskSectionProps {
  /** Names the section; its heading carries the id `${id}-heading`. */
  readonly id: string;
  readonly title: string;
  /** A count or control placed at the end of the heading row. */
  readonly headerEnd?: ReactNode;
  /** How `headerEnd` lines up with the title: on the text baseline, or centred. */
  readonly headerAlign?: keyof typeof HEADER_ALIGN | undefined;
  /** Space between the heading and the content, in the spacing scale. */
  readonly gap: keyof typeof SECTION_GAP;
  readonly children: ReactNode;
}

/**
 * A titled card in the task page's body: the frame Subtasks, Dependencies, and Activity share.
 *
 * @param props - See {@link TaskSectionProps}.
 * @returns a labelled `section` holding the heading and the content.
 */
export function TaskSection({
  id,
  title,
  headerEnd,
  headerAlign = 'center',
  gap,
  children,
}: TaskSectionProps): JSX.Element {
  const headingId = `${id}-heading`;
  const heading = (
    <h2 id={headingId} className="text-title-small text-on-surface">
      {title}
    </h2>
  );
  return (
    <Surface
      as="section"
      tone="card"
      pad="roomy"
      aria-labelledby={headingId}
      className={cn('flex flex-col', SECTION_GAP[gap])}
    >
      {headerEnd ? (
        <div className={cn('flex justify-between gap-3', HEADER_ALIGN[headerAlign])}>
          {heading}
          {headerEnd}
        </div>
      ) : (
        heading
      )}
      {children}
    </Surface>
  );
}
