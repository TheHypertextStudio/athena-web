'use client';

/**
 * The visual vocabulary for the six kinds of time.
 *
 * @remarks
 * Every surface that shows a scheduled block reads its label and glyph from here, so a filming
 * session looks like a filming session on the week board, in the morning agenda and in the
 * evening review — and adding a seventh shape is one entry in one total map rather than a hunt
 * through three files.
 *
 * The tone is carried on a tonal surface, never on a border: per the design system a border is
 * justified only for an editable affordance, focus, or a genuine semantic boundary, and "this is
 * a different kind of block" is none of those.
 */
import type { WorkShape } from '@docket/types';
import { Chip, Text } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { Blueprint, Edit, OpenBook, SelfImprovement, Users, VideoCamera } from '@docket/ui/icons';
import type { JSX, ReactNode } from 'react';

/** Everything a surface needs to render one shape consistently. */
interface ShapeVisual {
  /** Application-owned label; the same words the API's shape catalog returns. */
  readonly label: string;
  /** The glyph, from the MUI outlined set the rest of the app uses. */
  readonly icon: ReactNode;
  /** Tonal surface + on-colour pair for the chip and the block body. */
  readonly tone: string;
  /** A tonal accent for the block's leading edge, so a dense week is scannable by kind. */
  readonly accent: string;
}

/** A total map — a new shape is a compile error until it has a look. */
const SHAPE_VISUALS: Readonly<Record<WorkShape, ShapeVisual>> = {
  filming_session: {
    label: 'Filming session',
    icon: <VideoCamera fontSize="inherit" />,
    tone: 'bg-primary-container text-on-primary-container',
    accent: 'bg-primary',
  },
  community_meeting: {
    label: 'Community meeting',
    icon: <Users fontSize="inherit" />,
    tone: 'bg-secondary-container text-on-secondary-container',
    accent: 'bg-secondary',
  },
  deep_writing: {
    label: 'Writing and planning',
    icon: <Edit fontSize="inherit" />,
    tone: 'bg-tertiary-container text-on-tertiary-container',
    accent: 'bg-tertiary',
  },
  interstitial_reading: {
    label: 'Reading',
    icon: <OpenBook fontSize="inherit" />,
    tone: 'bg-surface-container-highest text-on-surface',
    accent: 'bg-outline',
  },
  reflection_debrief: {
    label: 'Reflection and debrief',
    icon: <SelfImprovement fontSize="inherit" />,
    tone: 'bg-surface-container-high text-on-surface-variant',
    accent: 'bg-outline-variant',
  },
  architecture_brainstorm: {
    label: 'Architecture brainstorming',
    icon: <Blueprint fontSize="inherit" />,
    tone: 'bg-surface-container-highest text-on-surface',
    accent: 'bg-on-surface-variant',
  },
};

/**
 * The look of one work shape.
 *
 * @param shape - The work shape.
 * @returns its label, glyph and tonal classes.
 */
export function shapeVisual(shape: WorkShape): ShapeVisual {
  return SHAPE_VISUALS[shape];
}

/** Props for {@link WorkShapeChip}. */
export interface WorkShapeChipProps {
  readonly shape: WorkShape;
  /** Omit to inherit the enclosing `ControlGroup`'s step. */
  readonly controlSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Override the label — used when a workspace name is more useful than the kind. */
  readonly label?: string;
}

/**
 * The readable badge naming one kind of time.
 *
 * @remarks
 * A `Chip` rather than a `Badge` because these are the app's own shape vocabulary and are always
 * rendered with their glyph — an icon-less chip does not compile, which is exactly the guarantee
 * that keeps a shape from ever appearing as a bare word with no visual identity.
 *
 * @param props - The shape, an optional control step, and an optional label override.
 * @returns the chip.
 */
export function WorkShapeChip(props: WorkShapeChipProps): JSX.Element {
  const visual = SHAPE_VISUALS[props.shape];
  return (
    <Chip
      icon={visual.icon}
      variant="assist"
      tone="tonal"
      {...(props.controlSize === undefined ? {} : { controlSize: props.controlSize })}
      className={cn(visual.tone, 'border-transparent')}
      data-work-shape={props.shape}
      aria-disabled
    >
      {props.label ?? visual.label}
    </Chip>
  );
}

/** Props for {@link WorkShapeLegend}. */
export interface WorkShapeLegendProps {
  /** The shapes actually present in the week, in taxonomy order. */
  readonly shapes: readonly WorkShape[];
}

/**
 * The legend of kinds present in a generated week.
 *
 * @remarks
 * Rendered from what the week actually contains, never from the full taxonomy: a legend listing
 * a kind the week does not have is a lie about the plan.
 *
 * @param props - The shapes present.
 * @returns the legend.
 */
export function WorkShapeLegend(props: WorkShapeLegendProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="work-shape-legend">
      <Text token="label-medium" tone="muted">
        Kinds of time in this week
      </Text>
      {props.shapes.map((shape) => (
        <WorkShapeChip key={shape} shape={shape} controlSize="xs" />
      ))}
    </div>
  );
}
