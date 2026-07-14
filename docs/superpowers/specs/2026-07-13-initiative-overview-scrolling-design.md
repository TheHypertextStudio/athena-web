# Initiative overview scrolling correction

## Problem

The Initiative roster currently replaces its six-column table with compact metadata until the
widest container breakpoint. This hides the established columns on medium viewports. The attention
surface also shifts into a single horizontal row at wide widths, making a narrative update read like
a toolbar.

## Design

- Keep compact hierarchy rows only on small/mobile containers.
- From the medium container breakpoint onward, show the complete table with Initiative, status,
  health, owner, target, and last-update columns.
- Give the table a minimum content width and make only its roster region horizontally scrollable
  when the available container is narrower than that width.
- Reserve a consistent two-line description area beneath every Initiative title. Descriptions wrap
  naturally and clamp after two lines; missing descriptions retain the same vertical space.
- Keep the attention surface vertically structured at every width: label and health, title and
  excerpt, then a footer with the action on the left and pagination on the right.
- Preserve the existing hierarchy indentation, responsive app shell, accessibility labels, and
  attention navigation behavior.

## Acceptance

- Medium viewports retain the six named columns instead of compact metadata.
- The roster scrolls horizontally without causing page-level horizontal overflow.
- Initiative rows have consistent heights, with descriptions wrapping to at most two lines.
- Attention content never shares one horizontal row with its controls.
- Mobile retains compact rows and all existing metadata.
