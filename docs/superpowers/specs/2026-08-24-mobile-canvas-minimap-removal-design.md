# Remove the mobile Canvas minimap

This design is for maintainers who change Work Canvas navigation. They must remove the persistent
minimap below the `sm` breakpoint while preserving the existing desktop overview.

## Decision

Project Dependencies and Task graph will hide the minimap below 640px. The mobile dock will retain
zoom in, zoom out, Fit all, Fit selection, and Re-layout. The desktop dock will retain the minimap
with its current panning and zooming behavior.

The Canvas will use responsive CSS instead of a JavaScript media query. This keeps server and
client rendering identical. It also avoids another viewport subscription inside React Flow. A
host that disables the minimap will continue to suppress it at every width.

## Reasoning

The 128×80 mobile minimap reduces 363 Tasks to marks that do not identify work or explain
relationships. It consumes 128px of a 320px viewport and competes with direct navigation commands.
Native Find, Fit selection, Fit all, Re-layout, zoom, and ordinary pan cover the useful mobile
navigation tasks without that permanent block.

The implementation will not add an Overview button or an auto-revealing minimap. Both alternatives
would retain a control for information that the user chose to remove. If later usage shows that
mobile users cannot find disconnected components, the next design should test an on-demand
full-canvas overview rather than restore the 128×80 minimap.

## Verification

The live review will capture both graph hosts at 320×720 and 390×844. Those captures must show no
minimap, no horizontal overflow, and no overlap between zoom and viewport actions. A desktop check
at 1024×768 must show that the minimap remains available. The review will cover light and dark
themes. Existing Canvas behavior tests will continue to cover minimap retention for wider layouts.

No product behavior remains undecided in this slice.
