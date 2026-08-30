# Dock the graph inspector beside the canvas

This design is for maintainers who change the task or project graph. They must stop selection
detail from covering the part of the diagram nearest the node the user just clicked, without
re-framing a graph the user has deliberately panned.

## Decision

`NodePeek` and `ProjectPeek` stop being XYFlow `<Panel position="top-right">` overlays and become a
docked column that is a flex sibling of the canvas. Reading an inspector costs width, not content.

The column's inline size is `clamp(16rem, 22%, 20rem)` — a share of the host, floored and capped,
which is the shell rail's width law scoped to a container instead of the viewport. A fixed width
that appears at a threshold is what makes a canvas narrower at a wider window; a share whose slope
stays under 1 cannot.

## The threshold is measured on the host, never the viewport

A viewport media query is wrong here and expensively so. `<main>` is
`viewport − 328px of chrome − the utility rail`, which is **416px** at a 1024px window with the rail
open. A `lg` query would dock a 280px inspector into that and leave 136px of graph.

So `GraphInspectorHost` observes its own width and docks at or above **768px** (the `@3xl` container
step). This diverges from `settings-pane.tsx`, which uses a viewport query for its split view, and
the divergence is deliberate: the inspector only exists after a click, so there is no first-paint
state to get wrong, and the boolean is needed in JS anyway — for `inert`, for focus, and for the
pan.

## Below the threshold the inspector covers the canvas

Rejected — **stack it below the graph**: a node-link diagram in a 416px `<main>` or an `h-80` embed
has no vertical budget to give away, and changing the canvas's _height_ re-runs the aspect-ratio
bucketing that decides the entire layout.

Rejected — **dismiss it below the threshold**: the inspector is the only thing selection does, so
removing it makes the click a no-op — which is the exact defect `project-peek.tsx`'s own docblock
says it exists to fix.

Chosen — **a pane over the canvas**, `absolute inset-0`, opaque, with the canvas column `inert`. It
changes neither canvas dimension, so the compact path needs no refit at all. One pane at a time is
also what MD3's adaptive guidance asks for at these sizes, and it matches the shell's own compact
behaviour.

## What must not happen: a relayout

`useCanvasAspectRatio`'s `containerRef` stays on the **host row**, never on the canvas column.
`coarseGraphAspectRatio` buckets at 0.8 and 1.25 and `useProjectGraphLayout` re-packs the whole
graph when the bucket flips — so measuring the narrowed column would re-pack the graph under the
user at the exact moment they opened something to read. The aspect ratio is docking-invariant.

## The pan, and why it is not a fitView

Docking can leave the selected node under the new column. `fitView()` would fix that by discarding
the pan and zoom the user chose, and on a graph that pan _is_ the reading position — re-framing
everything because a panel opened is a far bigger change than the one the user asked for.

Instead the canvas makes the **smallest** horizontal move that brings the selected node back inside
the visible region, and never touches zoom. A node already in the clear produces a genuine no-op,
not a zero-length animation. Undocking never pans: widening only reveals. The rule is a pure
function (`keepNodeInViewDeltaX`) so it can be verified by assertion rather than by eye.

The remaining canvas width is computed analytically on the frame the column mounts, as
`host width − pinned column width`. The pinned inner element carries the column's full width and is
never animated, so it reads correctly immediately; waiting for `transitionend` would either measure
a half-open column or never fire at all when motion is reduced.

`setViewport`'s duration is a JS animation, which the global `prefers-reduced-motion` CSS rule
cannot reach, so it is guarded explicitly with `prefersReducedMotion()`.

## What stays an overlay

Only the two selection inspectors move. These remain floating, because they are not side panels and
have nothing to occlude:

| Surface                                                  | Why it stays                                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Ready to start" (`bottom-left`)                         | Bottom-anchored, and an opt-in Display toggle rather than selection chrome. It is the last persistent floating panel on the canvas and the obvious next leg. |
| Empty states (`top-center`)                              | Centred over an empty canvas.                                                                                                                                |
| `BulkActionsBar`                                         | A bottom action bar over a selection — the established pattern.                                                                                              |
| `CanvasCreatedHiddenNotice`                              | A transient `role="status"` pill.                                                                                                                            |
| Canvas bottom chrome (controls, minimap, `bottomNotice`) | Viewport instruments, which must float by definition.                                                                                                        |

`canvas-overlay-panel.tsx` is therefore unchanged; its `!z-[2000]` is still correct for everything
that legitimately floats.

## Accessibility

The docked column does not take focus — it is a column beside the canvas, not a pane, and stealing
focus from the graph on every selection would break keyboard navigation of the diagram. The compact
pane does take focus and returns it to its opener, because it covers the canvas.

Either way the inspector owns `Escape` itself. The canvas's own Escape handler only fires while
`document.activeElement` is inside the canvas, which it no longer is once focus is in a covering
pane, so without this Escape would silently do nothing.

## Scope

Selection _changes_ while the inspector is already docked (walking neighbours through
`ProjectPeek`'s `onSelect`) do not pan. That matches today's behaviour and is out of scope here.

`applyCreatedSelection` in both graph panels hardcodes a `duration` without a reduced-motion guard.
Pre-existing, and left alone in this slice.
