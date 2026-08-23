import type { ViewLayout, ViewTarget } from '@docket/work/view-contract';

/** Renderer availability belongs to the presentation layer, never an object field contract. */
const RENDERER_TARGETS = {
  list: ['task', 'project', 'program', 'initiative'],
  board: ['task', 'project', 'program', 'initiative'],
  cards: ['task', 'project', 'program', 'initiative'],
  timeline: ['project', 'initiative'],
} as const satisfies Record<ViewLayout, readonly ViewTarget[]>;

/** Return the renderer choices that have an executable adapter for this collection target. */
export function workViewRendererLayouts(target: ViewTarget): readonly ViewLayout[] {
  return (Object.entries(RENDERER_TARGETS) as readonly [ViewLayout, readonly ViewTarget[]][])
    .filter(([, targets]) => targets.includes(target))
    .map(([layout]) => layout);
}

/** Whether the presentation layer can execute this target and renderer pairing. */
export function supportsWorkViewRenderer(target: ViewTarget, layout: ViewLayout): boolean {
  return (RENDERER_TARGETS[layout] as readonly ViewTarget[]).includes(target);
}
