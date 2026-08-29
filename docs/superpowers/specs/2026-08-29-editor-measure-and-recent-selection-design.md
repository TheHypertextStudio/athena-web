# Editor measure and recent selection

This design directs the Docket Web maintainer who changes entity documents and collapsed recent
navigation. The maintainer must make the editable surface follow the prose measure and make the
selected recent entity read as a navigation state instead of a small badge.

## Decision

Entity-document prose will remain capped at 75ch. The pale editable surface will use the same
75ch content measure plus its existing 16px padding on each side. At the desktop Contents
breakpoint, the document track will stop growing at that padded measure and the 11rem Contents
track will follow after a 16px gutter. The layout will keep shrinking to the available width below
that measure, and the mobile Contents disclosure will keep its current behavior.

Each recent-document shortcut will use a 56x48px target inside the 64x56px rail lane. The saved
32px entity identity will remain centered. Selection will fill that larger rounded rectangle with
the existing secondary-container color. Hover, focus, route behavior, and recent-item persistence
will not change.

## Alternatives rejected

Reducing only the current 32px grid gutter would leave the editable surface stretched across the
flexible column. Constraining only the editor text would leave the pale surface wider than its
contents and preserve the false visual gap. Removing the Contents gutter would make two separate
reading regions touch. A 40x40px recent target preserves the current badge-like selection and is
the defect this change removes.

## Verification

Source contracts will enforce the 75ch editor measure, padded document track, and 16px desktop
gutter. The navigation-rail component test will first fail while the recent shortcut remains
40x40px, then pass at 56x48px. The focused editor and shell suites will pass. An authenticated
production screenshot and browser measurements will verify the rendered surface, Contents gutter,
recent target, and unchanged 80px collapsed shell width.
